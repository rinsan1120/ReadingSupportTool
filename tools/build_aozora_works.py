#!/usr/bin/env python3
"""青空文庫の作品データ (aozora-works.js) を生成する。

入力:
  1. 青空文庫「作家別作品一覧拡充版」CSV (公式の一覧データ, CC BY 4.0)
     https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip
  2. 国立国語研究所『ひまわり』青空文庫パッケージの
     「作品別書誌情報一覧」xlsx (作品ごとの文字数を含む)
     https://csd.ninjal.ac.jp/archives/Aozora/aozora_list_YYYYMMDD.xlsx

出力 (aozora-works.js):
  window.AOZORA_WORKS = {
    "v": "20260401",                       // ひまわり側データの版
    "authors": [[人物ID, 著者名, 読み], ...],  // 読み順にソート済み
    "works": [[作品ID, 作品名, 著者index, 文字遣いコード, 文字数], ...]
  }
  文字遣いコード: 0=新字新仮名 1=新字旧仮名 2=旧字新仮名 3=旧字旧仮名 4=その他
  図書カードURLは 作品ID と 人物ID から復元できる:
    https://www.aozora.gr.jp/cards/<人物ID>/card<作品ID(ゼロなし)>.html

収録する作品の条件:
  - 作品著作権フラグが「なし」の作品だけ
  - 『ひまわり』側に文字数があり、1文字以上ある作品だけ
    (文字数のない作品は初版では除外する。2026-11-11 の判断)
  - 版の優先 (新字新仮名を優先) は『ひまわり』側の選定で済んでいる。
    同じ題名の複数作品IDは、シリーズ物の各話 (例: 銭形平次捕物控の各話) や
    前編/後編など別作品の場合が大半なので、題名での名寄せはしない。
    表示名には副題を併記する (例: 「或る女 2 (後編)」)。

使い方:
  python3 tools/build_aozora_works.py [--csv URL-or-path] [--xlsx URL-or-path]
                                      [--out path]
  省略時は公式URLから取得する。依存: openpyxl (xlsx の読み取りのみ)
"""

import argparse
import csv
import gzip
import io
import json
import sys
import urllib.request
import zipfile
from collections import defaultdict

DEFAULT_CSV_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip"
DEFAULT_XLSX_URL = "https://csd.ninjal.ac.jp/archives/Aozora/aozora_list_20260401.xlsx"

KANA_CODE = {"新字新仮名": 0, "新字旧仮名": 1, "旧字新仮名": 2, "旧字旧仮名": 3}


def load_bytes(source):
    if source.startswith("http://") or source.startswith("https://"):
        with urllib.request.urlopen(source) as response:
            return response.read()
    with open(source, "rb") as f:
        return f.read()


def read_catalog(csv_source):
    """公式CSVから、著作権なし作品を 作品ID -> 代表行(著者) で返す。"""
    raw = load_bytes(csv_source)
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            name = next(n for n in zf.namelist() if n.endswith(".csv"))
            raw = zf.read(name)
    text = raw.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    works = {}
    for row in rows:
        if row["作品著作権フラグ"] != "なし":
            continue
        work_id = row["作品ID"].zfill(6)
        current = works.get(work_id)
        # 1作品に複数行 (著者・翻訳者など) あるので、著者の行を優先する
        if current is None or (row["役割フラグ"] == "著者" and current["役割フラグ"] != "著者"):
            works[work_id] = row
    return works


def read_counts(xlsx_source):
    """『ひまわり』xlsxから 作品ID -> 文字数 を返す。"""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(load_bytes(xlsx_source)), read_only=True, data_only=True)
    ws = wb["作品別書誌情報一覧"]
    counts = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        work_id, chars = row[0], row[15]
        if work_id is None or chars is None:
            continue
        counts[str(work_id).zfill(6)] = int(chars)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=DEFAULT_CSV_URL)
    parser.add_argument("--xlsx", default=DEFAULT_XLSX_URL)
    parser.add_argument("--out", default="aozora-works.js")
    args = parser.parse_args()

    catalog = read_catalog(args.csv)
    counts = read_counts(args.xlsx)
    print(f"公式CSVの著作権なし作品: {len(catalog)} 件")
    print(f"ひまわり側の文字数データ: {len(counts)} 件")

    no_count = zero_count = 0
    candidates = []
    for work_id, row in catalog.items():
        chars = counts.get(work_id)
        if chars is None:
            no_count += 1
            continue
        if chars <= 0:
            zero_count += 1
            continue
        author = (row["姓"] or "") + (row["名"] or "")
        reading = (row["姓読み"] or "") + (row["名読み"] or "")
        sort_reading = (row["姓読みソート用"] or "") + (row["名読みソート用"] or "")
        title = row["作品名"]
        if row["副題"]:
            title = title + " " + row["副題"]
        candidates.append({
            "work_id": work_id,
            "title": title,
            "title_sort": row["ソート用読み"] or row["作品名"],
            "person_id": row["人物ID"].zfill(6),
            "author": author,
            "reading": reading,
            "sort_reading": sort_reading or reading,
            "kana": row["文字遣い種別"],
            "chars": chars,
        })
    print(f"文字数なしで除外: {no_count} 件 / 文字数0で除外: {zero_count} 件")

    deduped = candidates

    # 著者テーブル (読み順) を作り、作品は著者順→作品名順に並べる
    authors = {}
    for work in deduped:
        authors[work["person_id"]] = (work["author"], work["reading"], work["sort_reading"])
    author_rows = sorted(authors.items(), key=lambda kv: (kv[1][2], kv[1][0]))
    author_index = {person_id: i for i, (person_id, _) in enumerate(author_rows)}

    deduped.sort(key=lambda w: (author_index[w["person_id"]], w["title_sort"], w["work_id"]))
    import re
    version_match = re.search(r"(\d{8})", args.xlsx)
    data = {
        "v": version_match.group(1) if version_match else "",
        "authors": [[pid, name, reading] for pid, (name, reading, _) in author_rows],
        "works": [[
            w["work_id"], w["title"], author_index[w["person_id"]],
            KANA_CODE.get(w["kana"], 4), w["chars"],
        ] for w in deduped],
    }
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    header = (
        "// 青空文庫の作品データ (よみじたく「朗読作品を探す」用)\n"
        "// 出典: 青空文庫 (https://www.aozora.gr.jp/) の一覧データ (CC BY 4.0) と、\n"
        "// 国立国語研究所『ひまわり』青空文庫パッケージの文字数を組み合わせて生成。\n"
        "// 生成: tools/build_aozora_works.py\n"
    )
    content = header + "window.AOZORA_WORKS=" + payload + ";\n"
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(content)
    raw_size = len(content.encode("utf-8"))
    gz_size = len(gzip.compress(content.encode("utf-8")))
    print(f"出力: 作品 {len(deduped)} 件 / 著者 {len(author_rows)} 人")
    print(f"ファイルサイズ: {raw_size:,} bytes (gzip {gz_size:,} bytes) -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
