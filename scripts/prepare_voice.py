"""Build pinned CPU-only whisper-cli and bundle a verified multilingual model."""
import hashlib
import json
import shutil
import struct
import subprocess
import tarfile
import urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


def download(url, path, expected):
    if not path.is_file():
        partial = path.with_suffix('.part')
        with urllib.request.urlopen(url, timeout=120) as response, partial.open('wb') as output:
            shutil.copyfileobj(response, output)
        partial.rename(path)
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise SystemExit('Voice download integrity mismatch: ' + path.name)


def prepare():
    manifest = json.loads((ROOT / 'runtime/voice-manifest.json').read_text())
    cache = ROOT / '.runtime-cache/voice'
    cache.mkdir(parents=True, exist_ok=True)
    archive, model = cache / 'source.tar.gz', cache / 'model.bin'
    download(manifest['sourceUrl'], archive, manifest['sourceSha256'])
    download(manifest['modelUrl'], model, manifest['modelSha256'])
    source = cache / ('whisper.cpp-' + manifest['commit'])
    if not source.is_dir():
        with tarfile.open(archive) as tar:
            if any(m.issym() or m.islnk() or m.name.startswith('/') or '..' in Path(m.name).parts for m in tar.getmembers()):
                raise SystemExit('Unsafe voice source archive')
            tar.extractall(cache, filter='data')
    build = cache / 'build'
    subprocess.run(['cmake', '-S', str(source), '-B', str(build), '-DCMAKE_BUILD_TYPE=Release',
                    '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF',
                    '-DGGML_CUDA=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF',
                    '-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc'], check=True)
    subprocess.run(['cmake', '--build', str(build), '--config', 'Release', '--target', 'whisper-cli', '-j', '2'], check=True)
    destination = ROOT / 'bin/voice'
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(build / 'bin/whisper-cli', destination / 'whisper-cli')
    (destination / 'whisper-cli').chmod(0o755)
    shutil.copyfile(model, destination / 'model.bin')
    licenses = ROOT / 'licenses'
    licenses.mkdir(exist_ok=True)
    shutil.copyfile(source / 'LICENSE', licenses / 'whisper.cpp-MIT.txt')
    shutil.copyfile(source / 'LICENSE', licenses / 'ggml-MIT.txt')
    download('https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE', cache / 'model-LICENSE', 'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d')
    shutil.copyfile(cache / 'model-LICENSE', licenses / 'Whisper-model-MIT.txt')
    files = {str(p.relative_to(ROOT / 'bin')): hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
             for p in sorted(destination.iterdir()) if p.is_file()}
    (ROOT / 'runtime/voice-installed.json').write_text(json.dumps({'version': manifest['version'], 'files': files}, indent=2) + '\n')
    subprocess.run([str(destination / 'whisper-cli'), '--help'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pcm = bytes(16000 * 2)
    silence = cache / 'silence.wav'
    silence.write_bytes(struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(pcm), b'WAVE', b'fmt ', 16, 1, 1, 16000, 32000, 2, 16, b'data', len(pcm)) + pcm)
    subprocess.run([str(destination / 'whisper-cli'), '-m', str(destination / 'model.bin'), '-f', str(silence), '-l', 'de', '-t', '2', '-ng', '-nt', '-otxt', '-of', str(cache / 'silence')], check=True, timeout=90)
    assert (cache / 'silence.txt').is_file(), 'Inference did not produce output'
    print('Verified local voice runtime and offline inference')


if __name__ == '__main__':
    prepare()
