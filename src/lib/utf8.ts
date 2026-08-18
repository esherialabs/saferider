export function utf8ToBytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  const bytes: number[] = [];

  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(
        0xc0 | (codePoint >> 6),
        0x80 | (codePoint & 0x3f),
      );
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return new Uint8Array(bytes);
}

function appendCodePoint(output: string, codePoint: number): string {
  if (codePoint <= 0xffff) {
    return output + String.fromCharCode(codePoint);
  }

  const adjusted = codePoint - 0x10000;
  return output + String.fromCharCode(
    0xd800 + (adjusted >> 10),
    0xdc00 + (adjusted & 0x3ff),
  );
}

function isContinuationByte(value: number): boolean {
  return (value & 0xc0) === 0x80;
}

export function bytesToUtf8(value: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(value);
  }

  let output = '';
  let i = 0;

  while (i < value.length) {
    const first = value[i];

    if (first <= 0x7f) {
      output += String.fromCharCode(first);
      i += 1;
      continue;
    }

    if (
      first >= 0xc2 &&
      first <= 0xdf &&
      i + 1 < value.length &&
      isContinuationByte(value[i + 1])
    ) {
      output = appendCodePoint(output, ((first & 0x1f) << 6) | (value[i + 1] & 0x3f));
      i += 2;
      continue;
    }

    if (
      first >= 0xe0 &&
      first <= 0xef &&
      i + 2 < value.length &&
      isContinuationByte(value[i + 1]) &&
      isContinuationByte(value[i + 2])
    ) {
      const codePoint = ((first & 0x0f) << 12) |
        ((value[i + 1] & 0x3f) << 6) |
        (value[i + 2] & 0x3f);
      output = appendCodePoint(output, codePoint);
      i += 3;
      continue;
    }

    if (
      first >= 0xf0 &&
      first <= 0xf4 &&
      i + 3 < value.length &&
      isContinuationByte(value[i + 1]) &&
      isContinuationByte(value[i + 2]) &&
      isContinuationByte(value[i + 3])
    ) {
      const codePoint = ((first & 0x07) << 18) |
        ((value[i + 1] & 0x3f) << 12) |
        ((value[i + 2] & 0x3f) << 6) |
        (value[i + 3] & 0x3f);
      output = appendCodePoint(output, codePoint);
      i += 4;
      continue;
    }

    output += '\ufffd';
    i += 1;
  }

  return output;
}
