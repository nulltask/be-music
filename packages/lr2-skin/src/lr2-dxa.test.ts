import { describe, expect, it } from 'vitest';
import { readDxaArchive } from './lr2-dxa.ts';

describe('readDxaArchive', () => {
  it('rejects non-DXA bytes (no DX magic after decryption)', () => {
    const fake = new Uint8Array(32);
    expect(readDxaArchive(fake)).toBeUndefined();
  });

  it('rejects too-short input', () => {
    const tiny = new Uint8Array(8);
    expect(readDxaArchive(tiny)).toBeUndefined();
  });

  it('accepts a synthesized minimal V3 archive (single uncompressed file)', () => {
    // Build a minimal V3 archive in memory: - Header (24 bytes) - Data area: file data 'hello world' (11 bytes) at
    // offset 24 - FileNameTable @ 24 + 11 = 35 (8-byte aligned → 40 actually, but we lay it tightly here — the spec
    // doesn't enforce alignment for reads, just the encoder chooses 8-byte alignment in practice). - FileTable @
    // FileNameTableHead + 0 - DirectoryTable @ FileTableHead + 2 entries × 44 = 88
    //
    // Two file-table entries: the implicit root-directory self-entry (empty name, dir attr) + one regular file entry
    // pointing at the 11-byte payload.
    const dataPayload = new TextEncoder().encode('hello world');
    const filename = new TextEncoder().encode('file.txt');
    // Filename entry: WORD packNum=0, WORD reserved=0, then null-terminated name.
    const nameEntry = new Uint8Array(4 + filename.byteLength + 1);
    nameEntry.set(filename, 4);
    // Round file-name table to a multiple of 4 bytes so the next entry aligns; here we have 1 entry total + the leading
    // "" entry of the root.
    const rootNameEntry = new Uint8Array(4); // packNum=0, reserved=0, then null name
    const fileNameTable = new Uint8Array(rootNameEntry.byteLength + nameEntry.byteLength);
    fileNameTable.set(rootNameEntry, 0);
    fileNameTable.set(nameEntry, rootNameEntry.byteLength);

    const fileTable = new Uint8Array(2 * 44);
    // Root entry — name @ 0 (empty), attributes = 0x10 (dir), dataSize = 0, dataHead = 0, pressDataSize = 0xFFFFFFFF
    // (n/a)
    new DataView(fileTable.buffer).setUint32(0, 0, true); // nameAddress
    new DataView(fileTable.buffer).setUint32(4, 0x10, true); // attr (dir)
    new DataView(fileTable.buffer).setUint32(40, 0xffffffff, true); // press
    // Regular file entry — name @ 4 (start of "file.txt" sub-entry), attr = 0x20 (archive), dataHead = 0, dataSize =
    // 11, pressDataSize = 0xFFFFFFFF (uncompressed)
    new DataView(fileTable.buffer).setUint32(44 + 0, rootNameEntry.byteLength, true);
    new DataView(fileTable.buffer).setUint32(44 + 4, 0x20, true);
    new DataView(fileTable.buffer).setUint32(44 + 32, 0, true); // dataHead
    new DataView(fileTable.buffer).setUint32(44 + 36, dataPayload.byteLength, true);
    new DataView(fileTable.buffer).setUint32(44 + 40, 0xffffffff, true);

    const dirTable = new Uint8Array(16);
    new DataView(dirTable.buffer).setUint32(0, 0, true); // own DirAddress
    new DataView(dirTable.buffer).setUint32(4, 0xffffffff, true); // parent
    new DataView(dirTable.buffer).setUint32(8, 1, true); // fileNum (1 real child)
    new DataView(dirTable.buffer).setUint32(12, 44, true); // fileHead (skip self entry)

    // Compose
    const HEADER = 24;
    const fileNameTableHead = HEADER + dataPayload.byteLength;
    const fileTableHead = fileNameTable.byteLength;
    const directoryTableHead = fileTableHead + fileTable.byteLength;
    const totalTableSize = fileTableHead + fileTable.byteLength + dirTable.byteLength;
    const total = fileNameTableHead + totalTableSize;
    const plain = new Uint8Array(total);
    const view = new DataView(plain.buffer);
    plain[0] = 0x44; // 'D'
    plain[1] = 0x58; // 'X'
    plain[2] = 3; // version
    plain[3] = 0; // flags
    view.setUint32(4, totalTableSize, true); // HeadSize
    view.setUint32(8, HEADER, true); // DataHead
    view.setUint32(12, fileNameTableHead, true); // FileNameTableHead
    view.setUint32(16, fileTableHead, true); // FileTableHead (relative)
    view.setUint32(20, directoryTableHead, true); // DirectoryTableHead (relative)
    plain.set(dataPayload, HEADER);
    plain.set(fileNameTable, fileNameTableHead);
    plain.set(fileTable, fileNameTableHead + fileTableHead);
    plain.set(dirTable, fileNameTableHead + directoryTableHead);

    // XOR-encrypt with the default 12-byte key (so it round-trips).
    const key = [0x55, 0xaa, 0x20, 0x55, 0x55, 0x06, 0x55, 0xaa, 0x55, 0xd5, 0x7c, 0x66];
    const encrypted = new Uint8Array(plain.length);
    for (let i = 0; i < plain.length; i += 1) {
      encrypted[i] = plain[i]! ^ key[i % 12]!;
    }

    const archive = readDxaArchive(encrypted);
    expect(archive).toBeDefined();
    expect(archive!.version).toBe(3);
    expect(archive!.files).toHaveLength(1);
    expect(archive!.files[0]!.path).toBe('file.txt');
    expect(new TextDecoder().decode(archive!.files[0]!.data)).toBe('hello world');
  });
});
