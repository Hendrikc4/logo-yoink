// Immutable model revision and content hash; setup is the only downloader.
export const RUNTIME_VERSION = '1.22.0';
export const MODEL = Object.freeze({
  id: 'birefnet-lite-512',
  revision: '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7',
  url: 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/onnx/model.onnx',
  sha256: '1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2',
  license: 'MIT',
  size: 512,
  architecture: 'birefnet',
  padding: true,
  tiles: true,
  preset: 'logo-flat-soft-matting-v2',
});
