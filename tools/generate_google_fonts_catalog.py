#!/usr/bin/env python3
"""从固定的 Google Fonts Git 提交生成离线目录。"""

import argparse
import ast
import json
import re
import subprocess
from pathlib import Path


FIELD = re.compile(r'^\s*([a-z_]+):\s*("(?:\\.|[^"\\])*"|[^#\s]+)')
PINNED_COMMIT = "23e54b51ddffbc7713c583748e3bd86f62b1fa4a"
LICENSE_NAMES = ("OFL.txt", "LICENSE.txt", "LICENCE.txt", "UFL.txt")
WEIGHT_NAMES = {
    100: "极细", 200: "纤细", 300: "细体", 400: "常规", 500: "中等",
    600: "半粗", 700: "粗体", 800: "特粗", 900: "极粗",
}


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def parse_fields(lines: list[str]) -> dict[str, list[object]]:
    result: dict[str, list[object]] = {}
    for line in lines:
        match = FIELD.match(line)
        if match:
            value = match.group(2)
            result.setdefault(match.group(1), []).append(
                ast.literal_eval(value) if value.startswith('"') else value
            )
    return result


def first(fields: dict[str, list[object]], key: str, default: object = "") -> object:
    return fields.get(key, [default])[0]


def parse_metadata(path: Path) -> tuple[dict[str, list[object]], list[dict[str, list[object]]]]:
    top: list[str] = []
    styles: list[dict[str, list[object]]] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if re.match(r"^\s*fonts\s*\{", line):
            block: list[str] = []
            depth = line.count("{") - line.count("}")
            index += 1
            while index < len(lines) and depth:
                line = lines[index]
                depth += line.count("{") - line.count("}")
                if depth:
                    block.append(line)
                index += 1
            styles.append(parse_fields(block))
            continue
        if not line.startswith(" ") and not line.startswith("\t"):
            top.append(line)
        index += 1
    return parse_fields(top), styles


def generate(repo: Path) -> dict[str, object]:
    commit = git(repo, "rev-parse", "HEAD")
    if commit != PINNED_COMMIT:
        raise ValueError(f"需要检出固定提交 {PINNED_COMMIT}，当前为 {commit}")
    objects: dict[str, str] = {}
    for line in git(repo, "ls-tree", "-r", "HEAD", "ofl", "apache", "ufl").splitlines():
        metadata, path = line.split("\t", 1)
        objects[path] = metadata.split()[2]

    families: list[dict[str, object]] = []
    skipped: list[str] = []
    for relative in sorted(path for path in objects if path.endswith("/METADATA.pb")):
        directory = Path(relative).parent
        metadata_path = repo / relative
        if not metadata_path.is_file():
            raise ValueError(f"缺少元数据：{relative}")
        license_path = next(
            (directory / name for name in LICENSE_NAMES if (directory / name).as_posix() in objects),
            None,
        )
        if license_path is None or not (repo / license_path).is_file():
            skipped.append(relative)
            continue
        top, entries = parse_metadata(metadata_path)
        styles: list[dict[str, object]] = []
        seen: set[str] = set()
        for entry in entries:
            filename = str(first(entry, "filename"))
            if not filename or Path(filename).name != filename or filename in seen:
                continue
            path = (directory / filename).as_posix()
            if path not in objects or Path(filename).suffix.lower() not in (".ttf", ".otf", ".ttc", ".otc"):
                continue
            seen.add(filename)
            weight = int(first(entry, "weight", "400"))
            variable = "[" in filename
            posture = "斜体" if first(entry, "style", "normal") == "italic" else "正体"
            style_name = ("可变" if variable else WEIGHT_NAMES.get(weight, str(weight))) + " · " + posture
            styles.append({
                "id": filename,
                "path": path,
                "git_oid": objects[path],
                "style": style_name,
                "weight": weight,
                "variable": variable,
            })
        if not styles:
            skipped.append(relative)
            continue
        families.append({
            "id": directory.as_posix(),
            "name": str(first(top, "name")),
            "designer": str(first(top, "designer")),
            "category": str(first(top, "category")),
            "subsets": sorted(set(map(str, top.get("subsets", []))) - {"menu"}),
            "license": str(first(top, "license")),
            "license_path": license_path.as_posix(),
            "license_text": (repo / license_path).read_text(encoding="utf-8-sig", errors="replace"),
            "styles": styles,
        })
    if len(families) < 1000:
        raise ValueError(f"目录字族数量异常：{len(families)}")
    print(f"Google Fonts {commit}: {len(families)} 个字族，跳过 {len(skipped)} 个无可用字体或授权文件的条目")
    return {"provider": "google-fonts", "commit": commit, "families": families}


def main() -> None:
    parser = argparse.ArgumentParser(description="生成固定版本的 Google Fonts 离线目录")
    parser.add_argument("checkout", type=Path, help="已检出目标提交的 google/fonts 仓库")
    parser.add_argument("output", type=Path, help="输出 JSON 文件")
    args = parser.parse_args()
    payload = generate(args.checkout)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
