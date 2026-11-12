"""Build a reproducible source+compiled Web handoff; no dependency/cache discovery."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import posixpath
import re

root = Path(__file__).resolve().parents[2]
files = ["README.md", "启动体验.cmd", "重构与发行规划.md", ".gitignore"]
files += ["game/" + name for name in ("package.json", "pnpm-lock.yaml", "tsconfig.json", "index.html", "styles.css", "favicon.svg")]
files += ["game/src/" + name for name in ("main.ts", "core/game.ts", "render/scene.ts", "content/catalog.ts", "services/audio.ts", "services/score.ts", "services/store.ts")]
files += ["game/tests/" + name for name in ("browser.mjs", "core.test.mjs", "powerups.test.mjs", "store.test.mjs", "audio.test.mjs", "audio-browser.mjs")]
files += ["game/tools/" + name for name in ("build.mjs", "serve.mjs", "package.py")]
compiled = ["index.html", "styles.css", "favicon.svg", "main.js", "main.js.map"]
for name in ("core/game", "render/scene", "content/catalog", "services/audio", "services/score", "services/store"):
    compiled += [name + ".js", name + ".js.map"]
files += ["game/dist/" + name for name in compiled]
files += ["artifacts/browser-report.json", "artifacts/unit-tests-0.3.0.txt", "artifacts/audio-report-0.3.0.json", "artifacts/三场景配乐试听-0.3.0.wav"]
output = root / "artifacts/极限航域-0.3.0-Web源码与运行包.zip"
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        source = root / name
        assert source.is_file(), f"Missing deliverable: {name}"
        archive.write(source, "skybound-0.3.0/" + name)
with ZipFile(output) as archive:
    assert archive.testzip() is None
    names = set(archive.namelist())
    for filename in names:
        if not filename.endswith('.js'):
            continue
        for target in re.findall(r'''from\s*['"](\.[^'"]+)['"]''', archive.read(filename).decode('utf-8')):
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(filename), target))
            assert resolved in names, f'Missing runtime module: {resolved}'
print(f"{output.name}: {output.stat().st_size} bytes; {len(files)} files; CRC verified")
print("SHA256", hashlib.sha256(output.read_bytes()).hexdigest())
