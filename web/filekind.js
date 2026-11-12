// fileKind sorts an attached file by its MIME type, or by its name's
// extension when the type is missing or says nothing (octet-stream), so
// its chip can show a fitting icon. One of text, sheet, image, code,
// archive, audio, video or file.

const BY_TYPE = [
  ['sheet', /^text\/(csv|tab-separated-values)$|spreadsheet|ms-excel/],
  ['code', /json|javascript|typescript|ecmascript|xml|yaml|toml|^text\/(html|css)$|^text\/x-(?!markdown)/],
  ['text', /^text\/|^application\/(pdf|rtf|msword)$|wordprocessing|opendocument\.text/],
  ['image', /^image\//],
  ['audio', /^audio\//],
  ['video', /^video\//],
  ['archive', /zip|gzip|x-tar|x-bzip|x-xz|x-7z|x-rar|compressed/],
];

const BY_EXT = {
  text: 'pdf txt md markdown rtf doc docx odt log',
  sheet: 'csv tsv xls xlsx ods',
  image: 'png jpg jpeg gif webp avif svg bmp tif tiff heic ico',
  code: 'js mjs cjs ts tsx jsx json go py rb rs java c h cc cpp hpp cs php swift kt sh bash zsh html css scss sql yaml yml toml xml ini',
  archive: 'zip gz tgz tar bz2 xz 7z rar zst',
  audio: 'mp3 wav flac ogg oga m4a aac opus',
  video: 'mp4 mov webm mkv avi m4v',
};
const EXT = new Map(Object.entries(BY_EXT).flatMap(([kind, exts]) => exts.split(' ').map((e) => [e, kind])));

export function fileKind(type, name) {
  const t = (type || '').toLowerCase();
  if (t && t !== 'application/octet-stream') {
    for (const [kind, re] of BY_TYPE) if (re.test(t)) return kind;
  }
  const m = /\.([a-z0-9]+)$/.exec((name || '').toLowerCase());
  return (m && EXT.get(m[1])) || 'file';
}
