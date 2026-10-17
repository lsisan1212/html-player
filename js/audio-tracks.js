// Audio Track Manager
// Enumerates audio tracks in MP4/MOV (box parsing) and MKV/WebM (EBML),
// and switches between them — including dual-audio movies.
//
// Switching strategy:
//  - Safari / Firefox (native HTMLMediaElement.audioTracks): switch natively.
//  - Chrome / Edge (no audioTracks API): the selected track is extracted from
//    the container into a standalone file (AAC→ADTS, MP3, Opus→Ogg, FLAC, PCM→WAV,
//    MP4→M4A) and played through a hidden <audio> element kept in sync with the video.

// ===================== Codec helpers =====================

function friendlyCodec(codecId, stsdType) {
    const c = (codecId || '').toUpperCase();
    if (c.indexOf('A_AAC') === 0) return 'AAC';
    if (c.indexOf('A_MPEG/L3') === 0) return 'MP3';
    if (c.indexOf('A_MPEG/L2') === 0) return 'MP2';
    if (c.indexOf('A_OPUS') === 0) return 'Opus';
    if (c.indexOf('A_FLAC') === 0) return 'FLAC';
    if (c.indexOf('A_ALAC') === 0) return 'ALAC';
    if (c.indexOf('A_AC3') === 0 || c.indexOf('A_AC-3') === 0) return 'AC-3';
    if (c.indexOf('A_EAC3') === 0) return 'E-AC3';
    if (c.indexOf('A_DTS') === 0) return 'DTS';
    if (c.indexOf('A_TRUEHD') === 0) return 'TrueHD';
    if (c.indexOf('A_VORBIS') === 0) return 'Vorbis';
    if (c.indexOf('A_PCM') === 0) return 'PCM';
    switch ((stsdType || '').toLowerCase()) {
        case 'mp4a': return 'AAC';
        case 'alac': return 'ALAC';
        case 'ac-3': return 'AC-3';
        case 'ec-3': return 'E-AC3';
        case 'opus': return 'Opus';
        case '.mp3': return 'MP3';
        case 'samr': return 'AMR';
        case 'sowr': return 'AMR-WB';
    }
    return codecId || stsdType || '?';
}

// Can we extract + play this codec in the current browser?
function isPlayableCodec(codec) {
    return ['AAC', 'MP3', 'Opus', 'FLAC', 'PCM'].indexOf(codec) !== -1;
}

const LANG_NAMES = {
    yue: '粵', chi: '國', zho: '國', cmn: '國', eng: 'EN', jpn: '日', kor: '韓',
    tha: '泰', vie: '越', ind: '印尼', fra: '法', deu: '德', spa: '西', por: '葡',
    rus: '俄', und: '', mul: '多語'
};

function langLabel(lang) {
    if (!lang) return '';
    const l = lang.toLowerCase();
    return LANG_NAMES[l] || lang.toUpperCase();
}

// Derive channel count from CodecPrivate when the container doesn't state it
function deriveChannels(codec, codecPrivate) {
    if (!codecPrivate) return 0;
    if (codec === 'AAC' && codecPrivate.length >= 2) return ((codecPrivate[1] >> 3) & 0xF) || 2;
    if (codec === 'Opus' && codecPrivate.length >= 10) return codecPrivate[9] || 2;
    if (codec === 'FLAC' && codecPrivate.length >= 13) {
        const v = (codecPrivate[10] << 16) | (codecPrivate[11] << 8) | codecPrivate[12];
        return ((v >> 1) & 0x7) + 1;
    }
    return 0;
}

function concatU8(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

function u32(bytes) { return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0; }
function u64(bytes) {
    let v = 0;
    for (let i = 0; i < 8; i++) v = v * 256 + bytes[i];
    return v;
}

// ===================== Container writers =====================

function synthASC(freq, ch) {
    const table = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    let freqIdx = 4;
    for (let i = 0; i < table.length; i++) { if (table[i] === freq) { freqIdx = i; break; } }
    const aot = 2; // AAC-LC
    return new Uint8Array([(aot << 3) | (freqIdx >> 1), ((freqIdx & 1) << 7) | ((ch || 2) << 3)]);
}

// Raw AAC frames → ADTS elementary stream (playable as .aac)
function wrapAACAdts(frames, codecPrivate, freq, ch) {
    let asc = (codecPrivate && codecPrivate.length >= 2) ? codecPrivate : synthASC(freq || 44100, ch || 2);
    const profile = Math.max(0, ((asc[0] >> 3) & 0x1F) - 1);
    // ASC layout: AOT(5) | freqIdx top-3 bits in byte0; freqIdx LSB + chanCfg in byte1
    const freqIdx = (((asc[0] & 0x07) << 1) | (asc[1] >> 7)) & 0xF;
    const chanCfg = (asc[1] >> 3) & 0xF;

    let total = 0;
    for (const f of frames) total += 7 + f.data.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const f of frames) {
        const len = 7 + f.data.length;
        out[off] = 0xFF;
        out[off + 1] = 0xF1; // MPEG-4, layer 0, no CRC
        out[off + 2] = (profile << 6) | (freqIdx << 2) | ((chanCfg >> 2) & 1);
        out[off + 3] = ((chanCfg & 3) << 6) | ((len >> 11) & 3);
        out[off + 4] = (len >> 3) & 0xFF;
        out[off + 5] = ((len & 7) << 5) | 0x1F;
        out[off + 6] = 0xFC;
        out.set(f.data, off + 7);
        off += len;
    }
    return out;
}

// ---- Ogg (Opus) ----
function oggCRC32(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) {
        crc ^= bytes[i] << 24;
        for (let b = 0; b < 8; b++) {
            crc = (crc & 0x80000000) ? (((crc << 1) ^ 0x04C11DB7) >>> 0) : ((crc << 1) >>> 0);
        }
    }
    return crc >>> 0;
}

function oggPage(headerType, granule, serial, seq, packets) {
    const segments = [];
    for (const p of packets) {
        let len = p.length;
        while (len >= 255) { segments.push(255); len -= 255; }
        segments.push(len);
    }
    const page = new Uint8Array(27 + segments.length + packets.reduce((s, p) => s + p.length, 0));
    page[0] = 0x4F; page[1] = 0x67; page[2] = 0x67; page[3] = 0x53; // 'OggS'
    page[4] = 0; // version
    page[5] = headerType;
    // granule LE64
    let g = granule;
    for (let i = 0; i < 8; i++) { page[6 + i] = g % 256; g = Math.floor(g / 256); }
    // serial + seq LE32
    for (let i = 0; i < 4; i++) page[14 + i] = (serial >>> (8 * i)) & 0xFF;
    for (let i = 0; i < 4; i++) page[18 + i] = (seq >>> (8 * i)) & 0xFF;
    // CRC placeholder 0
    page[26] = segments.length;
    page.set(segments, 27);
    let off = 27 + segments.length;
    for (const p of packets) { page.set(p, off); off += p.length; }
    const crc = oggCRC32(page);
    for (let i = 0; i < 4; i++) page[22 + i] = (crc >>> (8 * i)) & 0xFF;
    return page;
}

// Opus frame duration (samples @48k) from the TOC byte
function opusFrameSamples(pkt) {
    const cfg = (pkt[0] >> 3) & 0x1F;
    const ms = [2.5, 5, 10, 20, 40, 60][cfg];
    return Math.round((ms || 20) * 48);
}

// Raw Opus packets → Ogg Opus file (.opus)
function wrapOggOpus(frames, codecPrivate, channels) {
    const serial = 0x12345678;
    const pages = [];
    let head;
    if (codecPrivate && codecPrivate.length >= 19) {
        head = codecPrivate.slice(0, 19);
    } else {
        head = new Uint8Array(19);
        head.set([0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // 'OpusHead'
        head[8] = 1; // version
        head[9] = channels || 2;
        head[10] = 0x80; head[11] = 0x01; // pre-skip 384
        head[12] = 0x80; head[13] = 0xBB; head[14] = 0; head[15] = 0; // 48000
    }
    // Pre-skip from OpusHead (bytes 10-11 LE); granule positions are relative to
    // the output timeline which starts at -pre_skip, so every packet-end granule
    // is (pts + dur) * 48 + pre_skip (per Ogg Opus spec).
    const preskip = (codecPrivate && codecPrivate.length >= 12)
        ? (codecPrivate[10] | (codecPrivate[11] << 8))
        : 384;
    const tags = new Uint8Array([0x4F, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, // 'OpusTags'
        11, 0x68, 0x74, 0x6D, 0x6C, 0x2D, 0x70, 0x6C, 0x61, 0x79, 0x65, 0x72, // vendor len + str
        0, 0, 0, 0]); // 0 user comments
    pages.push(oggPage(0x02, 0, serial, 0, [head]));
    pages.push(oggPage(0x00, 0, serial, 1, [tags]));

    let seq = 2;
    let buf = [];
    let bufBytes = 0;
    let bufSegs = 0;
    let bufFirstPts = null; // pts (ms) of first packet in current page
    let lastGranule = 0;
    const flush = (headerType, granule) => {
        if (buf.length === 0) return;
        pages.push(oggPage(headerType, granule, serial, seq++, buf));
        buf = []; bufBytes = 0; bufSegs = 0; bufFirstPts = null;
    };
    for (const f of frames) {
        const segs = Math.floor(f.data.length / 255) + 1;
        // Flush on ~1s of page duration, or when segment/byte caps are near.
        // Keeps granulepos ranges small so players can seek precisely.
        if (bufFirstPts !== null &&
            (f.pts - bufFirstPts >= 1000 ||
             bufSegs + segs > 250 ||
             bufBytes + f.data.length > 65025)) {
            flush(0x00, lastGranule);
        }
        if (bufFirstPts === null) bufFirstPts = f.pts;
        buf.push(f.data);
        bufBytes += f.data.length;
        bufSegs += segs;
        // granulepos = output position at the end of the last packet in the page.
        // Frame duration: BlockDuration if the muxer provided one (truncated last
        // frame), otherwise the TOC byte.
        const durSamples = (f.durMs != null) ? Math.round(f.durMs * 48) : opusFrameSamples(f.data);
        lastGranule = Math.round(f.pts * 48) + durSamples + preskip;
    }
    // The final packet must live ON the EOS page — demuxers derive the last
    // packet's real (possibly truncated) duration from the EOS page's granule,
    // so an empty EOS page would lose the end-trim information.
    if (buf.length > 0) {
        flush(0x04, lastGranule);
    } else {
        pages.push(oggPage(0x04, lastGranule, serial, seq++, []));
    }
    return concatU8(pages);
}

// ---- FLAC ----
function buildStreamInfo(freq, ch, bitDepth) {
    const si = new Uint8Array(34);
    si[0] = 0x10; si[1] = 0x00; // min blocksize 4096
    si[2] = 0x10; si[3] = 0x00; // max blocksize 4096
    // min/max framesize = 0
    // 8 bytes: sampleRate(20) | channels-1(3) | bits-1(5) | totalSamples(36)
    const rate = Math.min(freq || 44100, 655350);
    const chans = Math.min(Math.max(ch || 2, 1), 8);
    const bits = Math.min(Math.max(bitDepth || 16, 4), 32);
    let v = rate * 8 + (chans - 1); // build in 3-byte chunks below
    // pack: bits 63..44 = rate, 43..41 = ch-1, 40..36 = bits-1, 35..0 = 0
    const hi = (rate << 4) | (chans - 1);          // 24 bits
    const lo = ((bits - 1) << 1);                  // 6 bits, shifted
    si[8] = (hi >>> 16) & 0xFF;
    si[9] = (hi >>> 8) & 0xFF;
    si[10] = hi & 0xFF;
    si[11] = ((lo >>> 5) & 0xFF) | 0; // top 3 bits of lo
    si[12] = ((lo & 0x1F) << 3);
    // total samples = 0 (unknown); md5 = zeros
    return si;
}

// Raw FLAC frames → .flac file
function wrapFLAC(frames, codecPrivate, freq, ch, bitDepth) {
    const parts = [];
    const cp = codecPrivate;
    if (cp && cp.length >= 42 && cp[0] === 0x66 && cp[1] === 0x4C && cp[2] === 0x61 && cp[3] === 0x43) {
        // CodecPrivate already is a complete FLAC file header ('fLaC' + metadata blocks)
        parts.push(cp);
    } else if (cp && cp.length >= 34) {
        // Bare STREAMINFO metadata block
        parts.push(new Uint8Array([0x66, 0x4C, 0x61, 0x43]));
        parts.push(new Uint8Array([0x80, 0x00, 0x00, 0x22]));
        parts.push(cp.slice(0, 34));
    } else {
        parts.push(new Uint8Array([0x66, 0x4C, 0x61, 0x43]));
        parts.push(new Uint8Array([0x80, 0x00, 0x00, 0x22]));
        parts.push(buildStreamInfo(freq, ch, bitDepth));
    }
    for (const f of frames) parts.push(f.data);
    return concatU8(parts);
}

// ---- WAV (PCM) ----
function wrapWAV(frames, ch, rate, bitDepth, isFloat) {
    const bytesPer = Math.ceil((bitDepth || 16) / 8);
    let dataLen = 0;
    for (const f of frames) dataLen += f.data.length;
    const out = new Uint8Array(44 + dataLen);
    const w = (off, str) => { for (let i = 0; i < str.length; i++) out[off + i] = str.charCodeAt(i); };
    const le32 = (off, v) => { out[off] = v & 0xFF; out[off + 1] = (v >> 8) & 0xFF; out[off + 2] = (v >> 16) & 0xFF; out[off + 3] = (v >> 24) & 0xFF; };
    const le16 = (off, v) => { out[off] = v & 0xFF; out[off + 1] = (v >> 8) & 0xFF; };
    w(0, 'RIFF');
    le32(4, 36 + dataLen);
    w(8, 'WAVE');
    w(12, 'fmt ');
    le32(16, 16);
    le16(20, isFloat ? 3 : 1);
    le16(22, ch || 2);
    le32(24, rate || 44100);
    le32(28, (rate || 44100) * (ch || 2) * bytesPer);
    le16(32, (ch || 2) * bytesPer);
    le16(34, bitDepth || 16);
    w(36, 'data');
    le32(40, dataLen);
    let off = 44;
    for (const f of frames) { out.set(f.data, off); off += f.data.length; }
    return out;
}

// ===================== MP4 / MOV parsing =====================

function* iterBoxes(u8, start, end) {
    let off = start;
    while (off + 8 <= end) {
        let size = u32(u8.slice(off, off + 4));
        const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
        let headerLen = 8;
        if (size === 1) {
            if (off + 16 > end) break;
            size = u64(u8.slice(off + 8, off + 16));
            headerLen = 16;
        } else if (size === 0) {
            size = end - off;
        }
        if (size < headerLen || off + size > end) break;
        yield { type, start: off, contentStart: off + headerLen, size, end: off + size };
        off += size;
    }
}

function findBox(u8, start, end, type) {
    for (const b of iterBoxes(u8, start, end)) {
        if (b.type === type) return b;
    }
    return null;
}

class MP4AudioParser {
    // Read the moov box (faststart: at head; otherwise: tail)
    static async _readMoov(file) {
        const HEAD = 8 * 1024 * 1024;
        let buf = new Uint8Array(await file.slice(0, Math.min(HEAD, file.size)).arrayBuffer());
        let moov = findBox(buf, 0, buf.length, 'moov');
        if (moov) {
            if (moov.end <= buf.length) return { u8: buf, moov };
            const end = Math.min(moov.end, file.size);
            buf = new Uint8Array(await file.slice(moov.start, end).arrayBuffer());
            return { u8: buf, moov: { type: 'moov', start: 0, contentStart: 8, end: buf.length } };
        }
        const TAIL = 32 * 1024 * 1024;
        const tailStart = Math.max(0, file.size - TAIL);
        buf = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
        moov = findBox(buf, 0, buf.length, 'moov');
        if (moov) return { u8: buf, moov };
        return null;
    }

    // Returns audio tracks [{trackId, name, lang, codec, channels, stbl, stsdRaw, timescale, duration}]
    static async enumerate(file) {
        const r = await this._readMoov(file);
        if (!r) return null;
        const u8 = r.u8;
        const traks = [];
        for (const trak of iterBoxes(u8, r.moov.contentStart, r.moov.end)) {
            if (trak.type !== 'trak') continue;
            const info = this._parseTrak(u8, trak);
            if (info && info.isAudio) traks.push(info);
        }
        return traks.length ? traks : null;
    }

    static _parseTrak(u8, trakBox) {
        const info = { isAudio: false, trackId: 0, name: '', lang: '', channels: 0, timescale: 0, duration: 0 };
        const mdia = findBox(u8, trakBox.contentStart, trakBox.end, 'mdia');
        if (!mdia) return info;

        // hdlr → handler type (FullBox: version+flags 4B, pre_defined 4B, then handler_type)
        const hdlr = findBox(u8, mdia.contentStart, mdia.end, 'hdlr');
        if (!hdlr) return info;
        const handler = String.fromCharCode(u8[hdlr.contentStart + 8], u8[hdlr.contentStart + 9], u8[hdlr.contentStart + 10], u8[hdlr.contentStart + 11]);
        if (handler !== 'soun') return info;
        info.isAudio = true;

        // tkhd → trackId + enabled flag
        const tkhd = findBox(u8, trakBox.contentStart, trakBox.end, 'tkhd');
        if (tkhd) {
            const v = u8[tkhd.contentStart];
            const base = v === 1 ? tkhd.contentStart + 4 + 16 : tkhd.contentStart + 4 + 8;
            info.trackId = u32(u8.slice(base, base + 4));
            const flags = ((u8[tkhd.contentStart + 1] << 16) | (u8[tkhd.contentStart + 2] << 8) | u8[tkhd.contentStart + 3]);
            info.enabled = (flags & 1) === 1;
        }

        // udta/name → track name
        const udta = findBox(u8, trakBox.contentStart, trakBox.end, 'udta');
        if (udta) {
            const nameBox = findBox(u8, udta.contentStart, udta.end, 'name');
            if (nameBox) {
                let s = '';
                for (let i = nameBox.contentStart; i < nameBox.end && u8[i] !== 0; i++) s += String.fromCharCode(u8[i]);
                info.name = s.trim();
            }
        }

        // mdhd → language + timescale
        const mdhd = findBox(u8, mdia.contentStart, mdia.end, 'mdhd');
        if (mdhd) {
            const v = u8[mdhd.contentStart];
            if (v === 1) {
                info.timescale = u32(u8.slice(mdhd.contentStart + 20, mdhd.contentStart + 24));
                info.duration = u64(u8.slice(mdhd.contentStart + 24, mdhd.contentStart + 32));
            } else {
                info.timescale = u32(u8.slice(mdhd.contentStart + 12, mdhd.contentStart + 16));
                info.duration = u32(u8.slice(mdhd.contentStart + 16, mdhd.contentStart + 20));
                const langPacked = (u8[mdhd.contentStart + 20] << 8) | u8[mdhd.contentStart + 21];
                info.langPacked = langPacked;
                info.lang = String.fromCharCode(
                    ((langPacked >> 10) & 0x1F) + 0x60,
                    ((langPacked >> 5) & 0x1F) + 0x60,
                    (langPacked & 0x1F) + 0x60
                ).toLowerCase();
            }
        }

        // minf/stbl
        const minf = findBox(u8, mdia.contentStart, mdia.end, 'minf');
        if (!minf) return info;
        const stbl = findBox(u8, minf.contentStart, minf.end, 'stbl');
        if (!stbl) return info;

        // stsd → first entry type + channels
        const stsd = findBox(u8, stbl.contentStart, stbl.end, 'stsd');
        if (stsd) {
            info.stsdRaw = u8.slice(stsd.start, stsd.end);
            const entryStart = stsd.contentStart + 8; // version/flags + entry_count
            const eType = String.fromCharCode(u8[entryStart + 4], u8[entryStart + 5], u8[entryStart + 6], u8[entryStart + 7]);
            info.codec = friendlyCodec('', eType);
            // AudioSampleEntry: 6 reserved + 2 dri + 8 reserved + 2 channelcount
            if (entryStart + 20 <= stsd.end) {
                info.channels = (u8[entryStart + 16] << 8) | u8[entryStart + 17];
            }
            if (!info.channels) info.channels = 2;
        }

        // tables
        const stts = findBox(u8, stbl.contentStart, stbl.end, 'stts');
        const stsc = findBox(u8, stbl.contentStart, stbl.end, 'stsc');
        const stsz = findBox(u8, stbl.contentStart, stbl.end, 'stsz');
        const stco = findBox(u8, stbl.contentStart, stbl.end, 'stco');
        const co64 = findBox(u8, stbl.contentStart, stbl.end, 'co64');
        if (!stts || !stsc || !stsz || (!stco && !co64)) {
            info.stbl = null; // fragmented MP4 (moof) or unusual layout — cannot extract
            return info;
        }

        info.stbl = {
            sttsRaw: u8.slice(stts.start, stts.end),
            stszRaw: u8.slice(stsz.start, stsz.end),
            stsc: this._parseStsc(u8, stsc),
            sampleSize: u32(u8.slice(stsz.contentStart + 4, stsz.contentStart + 8)),
            sampleCount: u32(u8.slice(stsz.contentStart + 8, stsz.contentStart + 12)),
            chunkOffsets: co64 ? this._parseCo64(u8, co64) : this._parseStco(u8, stco)
        };
        if (info.stbl.sampleSize === 0) {
            const sizes = [];
            const base = stsz.contentStart + 12;
            const n = info.stbl.sampleCount;
            for (let i = 0; i < n; i++) sizes.push(u32(u8.slice(base + i * 4, base + i * 4 + 4)));
            info.stbl.sampleSizes = sizes;
        }
        return info;
    }

    static _parseStsc(u8, box) {
        const count = u32(u8.slice(box.contentStart + 4, box.contentStart + 8));
        const out = [];
        for (let i = 0; i < count; i++) {
            const p = box.contentStart + 8 + i * 12;
            out.push([u32(u8.slice(p, p + 4)), u32(u8.slice(p + 4, p + 8)), u32(u8.slice(p + 8, p + 12))]);
        }
        return out;
    }

    static _parseStco(u8, box) {
        const count = u32(u8.slice(box.contentStart + 4, box.contentStart + 8));
        const out = [];
        for (let i = 0; i < count; i++) {
            const p = box.contentStart + 8 + i * 4;
            out.push(u32(u8.slice(p, p + 4)));
        }
        return out;
    }

    static _parseCo64(u8, box) {
        const count = u32(u8.slice(box.contentStart + 4, box.contentStart + 8));
        const out = [];
        for (let i = 0; i < count; i++) {
            const p = box.contentStart + 8 + i * 8;
            out.push(u64(u8.slice(p, p + 8)));
        }
        return out;
    }

    // Extract the audio track's samples and build a standalone .m4a
    static async extractTrack(file, trak, onProgress) {
        const stbl = trak.stbl;
        const samples = [];
        // chunk → sample count via stsc
        const chunkCounts = [];
        for (let c = 1; c <= stbl.chunkOffsets.length; c++) {
            let e = stbl.stsc[0];
            for (const ent of stbl.stsc) { if (ent[0] <= c) e = ent; }
            chunkCounts.push(e[1]);
        }
        let sampleIdx = 0;
        for (let c = 0; c < stbl.chunkOffsets.length; c++) {
            let off = stbl.chunkOffsets[c];
            const n = chunkCounts[c] || 0;
            for (let s = 0; s < n; s++) {
                const size = stbl.sampleSize !== 0 ? stbl.sampleSize : stbl.sampleSizes[sampleIdx];
                if (off + size <= file.size) samples.push({ offset: off, size });
                off += size;
                sampleIdx++;
            }
        }
        if (samples.length === 0) throw new Error('no audio samples found');

        // Sliding window read
        const WINDOW = 32 * 1024 * 1024;
        let winStart = -1, winEnd = -1, winBuf = null;
        const parts = [];
        let lastReport = -1;
        for (const s of samples) {
            if (s.offset < winStart || s.offset + s.size > winEnd) {
                winStart = s.offset;
                winEnd = Math.min(file.size, winStart + WINDOW);
                winBuf = new Uint8Array(await file.slice(winStart, winEnd).arrayBuffer());
                if (onProgress && s.offset / file.size - lastReport > 0.02) {
                    lastReport = s.offset / file.size;
                    onProgress(lastReport);
                }
            }
            parts.push(winBuf.subarray(s.offset - winStart, s.offset - winStart + s.size));
        }
        if (onProgress) onProgress(1);
        const mdat = concatU8(parts);
        return this._buildM4A(trak, mdat, samples.length);
    }

    static _buildM4A(trak, mdat, sampleCount) {
        const build = (mdatOffset) => {
            const ftyp = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, // size + 'ftyp'
                0x4D, 0x34, 0x41, 0x20, // 'M4A '
                0, 0, 0, 0,             // minor version
                0x6D, 0x70, 0x34, 0x32, // 'mp42'
                0x69, 0x73, 0x6F, 0x6D]); // 'isom'

            const box = (type, payload) => {
                const out = new Uint8Array(8 + payload.length);
                const size = out.length;
                out[0] = (size >>> 24) & 0xFF; out[1] = (size >>> 16) & 0xFF;
                out[2] = (size >>> 8) & 0xFF; out[3] = size & 0xFF;
                out[4] = type.charCodeAt(0); out[5] = type.charCodeAt(1);
                out[6] = type.charCodeAt(2); out[7] = type.charCodeAt(3);
                out.set(payload, 8);
                return out;
            };
            const fullBox = (type, version, flags, payload) => {
                const fp = new Uint8Array(payload.length + 4);
                fp[0] = version; fp[1] = (flags >>> 16) & 0xFF; fp[2] = (flags >>> 8) & 0xFF; fp[3] = flags & 0xFF;
                fp.set(payload, 4);
                return box(type, fp);
            };

            const durationMs = trak.timescale ? Math.round(trak.duration / trak.timescale * 1000) : 0;

            // mvhd (v0): creation, modification, timescale, duration, rate, volume, reserved(10), matrix(36), pre_defined(24), next_track_ID
            const mvhdPayload = new Uint8Array(96);
            const mv = new DataView(mvhdPayload.buffer);
            mv.setUint32(8, 1000);                       // timescale (ms)
            mv.setUint32(12, durationMs);                // duration
            mv.setUint32(16, 0x00010000);                // rate 1.0
            mv.setUint16(20, 0x0100);                    // volume 1.0
            const matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
            for (let i = 0; i < 9; i++) mv.setUint32(32 + i * 4, matrix[i]);
            mv.setUint32(92, 2);                         // next track ID
            const mvhd = fullBox('mvhd', 0, 0, mvhdPayload);

            // tkhd (v0, flags=7 enabled): creation, modification, trackID, reserved, duration, reserved(8),
            // layer, alternate, volume, reserved, matrix(36), width, height
            const tkhdPayload = new Uint8Array(80);
            const tv = new DataView(tkhdPayload.buffer);
            tv.setUint32(8, 1);                          // track ID
            tv.setUint32(16, durationMs);                // duration
            tv.setUint16(32, 0x0100);                    // volume
            for (let i = 0; i < 9; i++) tv.setUint32(36 + i * 4, matrix[i]);
            const tkhd = fullBox('tkhd', 0, 7, tkhdPayload);

            // mdhd (v0): creation, modification, timescale, duration, language(2), quality(2)
            const mdhdPayload = new Uint8Array(20);
            const mdv = new DataView(mdhdPayload.buffer);
            mdv.setUint32(8, trak.timescale || 1000);
            mdv.setUint32(12, trak.duration || 0);
            mdv.setUint16(16, trak.langPacked || 0x55C4);
            const mdhd = fullBox('mdhd', 0, 0, mdhdPayload);

            // hdlr
            const hdlrPayload = new Uint8Array(24);
            hdlrPayload.set([0x73, 0x6F, 0x75, 0x6E], 4); // 'soun'
            const name = 'SoundHandler';
            for (let i = 0; i < name.length; i++) hdlrPayload[16 + i] = name.charCodeAt(i);
            const hdlr = fullBox('hdlr', 0, 0, hdlrPayload);

            // smhd
            const smhd = fullBox('smhd', 0, 0, new Uint8Array(4));

            // dinf/dref/url
            const urlBox = new Uint8Array([0, 0, 0, 0x0C, 0x75, 0x72, 0x6C, 0x20, 0, 0, 0, 0]);
            const drefPayload = new Uint8Array(4 + urlBox.length);
            drefPayload.set([0, 0, 0, 1], 0);
            drefPayload.set(urlBox, 4);
            const dref = fullBox('dref', 0, 0, drefPayload);
            const dinf = box('dinf', dref);

            // stsc (single chunk): entry_count + {first_chunk, samples_per_chunk, desc_index}
            const stscPayload = new Uint8Array(16);
            const sv = new DataView(stscPayload.buffer);
            sv.setUint32(0, 1);              // 1 entry
            sv.setUint32(4, 1);              // first chunk
            sv.setUint32(8, sampleCount);    // samples per chunk
            sv.setUint32(12, 1);             // sample description index
            const stsc = fullBox('stsc', 0, 0, stscPayload);
            const stcoPayload = new Uint8Array(8);
            const cov = new DataView(stcoPayload.buffer);
            cov.setUint32(0, 1);
            cov.setUint32(4, mdatOffset);
            const stco = fullBox('stco', 0, 0, stcoPayload);

            const stbl = box('stbl', concatU8([trak.stsdRaw, trak.stbl.sttsRaw, stsc, trak.stbl.stszRaw, stco]));
            const minf = box('minf', concatU8([smhd, dinf, stbl]));
            const mdia = box('mdia', concatU8([mdhd, hdlr, minf]));
            const trakBox = box('trak', concatU8([tkhd, mdia]));
            const moov = box('moov', concatU8([mvhd, trakBox]));
            const mdatBox = new Uint8Array(8 + mdat.length);
            const size = mdatBox.length;
            mdatBox[0] = (size >>> 24) & 0xFF; mdatBox[1] = (size >>> 16) & 0xFF;
            mdatBox[2] = (size >>> 8) & 0xFF; mdatBox[3] = size & 0xFF;
            mdatBox[4] = 0x6D; mdatBox[5] = 0x64; mdatBox[6] = 0x61; mdatBox[7] = 0x74; // 'mdat'
            mdatBox.set(mdat, 8);
            return concatU8([ftyp, moov, mdatBox]);
        };

        // First pass to learn mdat offset, then rebuild with the real offset
        const probe = build(0);
        const mdatOffset = probe.length - mdat.length - 8 + 8; // ftyp + moov + mdat header
        return build(mdatOffset);
    }
}

// ===================== Manager =====================

class AudioTrackManager {
    constructor(player) {
        this.player = player;
        this.select = document.getElementById('audio-track-select');
        this.btn = document.getElementById('audio-btn');
        this.audioEl = document.createElement('audio');
        this.audioEl.preload = 'auto';

        this.tracks = [];
        this.nativeMode = false;
        this._nativeDone = false;
        this.currentIndex = 0;
        this.defaultIndex = 0;
        this.blobCache = new Map(); // index -> {url}
        this.extractToken = 0;
        this.container = null;
        this.file = null;
        this.progressEl = null;
        this._nativeVerifyTimer = null;

        this.init();
    }

    init() {
        document.addEventListener('videofile', (e) => this.onFile(e.detail.file));
        if (this.select) {
            this.select.addEventListener('change', (e) => this.onSelect(parseInt(e.target.value, 10)));
        }
        if (this.btn) {
            this.btn.addEventListener('click', () => this.cycleTrack());
        }

        const v = this.player.video;
        v.addEventListener('play', () => this.onVideoPlay());
        v.addEventListener('playing', () => this.onVideoPlay());
        v.addEventListener('pause', () => { this.audioEl.pause(); });
        v.addEventListener('waiting', () => { this.audioEl.pause(); });
        v.addEventListener('seeked', () => this.syncAudioTime(true));
        v.addEventListener('ratechange', () => { this.audioEl.playbackRate = v.playbackRate; });
        v.addEventListener('volumechange', () => { this.audioEl.volume = v.volume; this.audioEl.muted = v.muted; });
        v.addEventListener('ended', () => { this.audioEl.pause(); });

        this.driftTimer = setInterval(() => this.driftCheck(), 300);
    }

    osd(text) {
        if (typeof keyboard !== 'undefined' && keyboard.showOSD) keyboard.showOSD(text);
    }

    reset() {
        this.extractToken++;
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        this.audioEl.load();
        for (const [, entry] of this.blobCache) {
            if (entry.url) URL.revokeObjectURL(entry.url);
        }
        this.blobCache.clear();
        this.tracks = [];
        this.nativeMode = false;
        this._nativeDone = false;
        this.currentIndex = 0;
        this.defaultIndex = 0;
        this.file = null;
        this.container = null;
        this.player.video.muted = false;
        this.hideProgress();
        if (this.select) {
            this.select.innerHTML = '<option value="-1">Audio 1</option>';
            this.select.value = '-1';
        }
        this.setInfo('—');
        this.showSelector(false);
    }

    showSelector(show) {
        const wrap = this.select ? this.select.closest('.audio-track-selector') : null;
        if (wrap) wrap.style.display = show ? '' : 'none';
        else if (this.select) this.select.style.display = show ? '' : 'none';
    }

    setInfo(text) {
        const el = document.getElementById('info-audio');
        if (el) el.textContent = text;
    }

    async onFile(file) {
        this.reset();
        this.file = file;
        const name = (file.name || '').toLowerCase();

        try {
            if (name.endsWith('.mkv') || name.endsWith('.webm')) {
                this.container = 'mkv';
                const mkvTracks = await mkvExtractor.enumerateAudioTracks(file);
                if (mkvTracks && mkvTracks.length > 0) {
                    this.tracks = mkvTracks.map((t, i) => {
                        const codec = friendlyCodec(t.codecId, '');
                        return {
                            index: i,
                            mkvNumber: t.number,
                            lang: t.language,
                            name: t.name,
                            codec: codec,
                            channels: t.channels || deriveChannels(codec, t.codecPrivate),
                            playable: isPlayableCodec(codec),
                            raw: t
                        };
                    });
                }
            } else if (name.endsWith('.mp4') || name.endsWith('.m4v') || name.endsWith('.mov') || name.endsWith('.m4a')) {
                this.container = 'mp4';
                const traks = await MP4AudioParser.enumerate(file);
                if (traks && traks.length > 0) {
                    this.tracks = traks.map((t, i) => ({
                        index: i,
                        mp4Trak: t,
                        lang: t.lang || '',
                        name: t.name,
                        codec: t.codec || '?',
                        channels: t.channels,
                        playable: isPlayableCodec(t.codec || '?'),
                        raw: t
                    }));
                }
            }
        } catch (err) {
            console.warn('[Audio] enumeration failed:', err.message);
        }

        // Default = first playable track (what the browser plays natively)
        this.defaultIndex = 0;
        for (let i = 0; i < this.tracks.length; i++) {
            if (this.tracks[i].playable) { this.defaultIndex = i; break; }
        }
        this.currentIndex = this.defaultIndex;

        // Native audioTracks (Safari / Firefox) take priority once metadata loads
        this.player.video.addEventListener('loadedmetadata', () => this.tryNativeMode(), { once: true });

        this.populateUI();
    }

    async tryNativeMode() {
        const v = this.player.video;
        if (!v.audioTracks || v.audioTracks.length === 0) return;
        if (this._nativeDone) return;
        this._nativeDone = true;
        if (this.currentIndex !== this.defaultIndex) return; // extraction already in use

        this.nativeMode = true;
        const list = [];
        for (let i = 0; i < v.audioTracks.length; i++) {
            const t = v.audioTracks[i];
            list.push({
                index: i,
                native: t,
                lang: t.language || '',
                name: t.label || '',
                codec: this.tracks[i] ? this.tracks[i].codec : '',
                channels: this.tracks[i] ? this.tracks[i].channels : 0,
                playable: true
            });
        }
        this.tracks = list;
        this.defaultIndex = 0;
        for (let i = 0; i < list.length; i++) {
            if (list[i].native.enabled) { this.defaultIndex = i; break; }
        }
        this.currentIndex = this.defaultIndex;
        this.populateUI();
    }

    populateUI() {
        if (!this.select) return;
        this.showSelector(this.tracks.length > 1);
        this.select.innerHTML = '';
        for (const t of this.tracks) {
            const opt = document.createElement('option');
            opt.value = String(t.index);
            let label = `Audio ${t.index + 1}`;
            const lang = langLabel(t.lang);
            if (lang) label += ` · ${lang}`;
            if (t.name) label += ` · ${t.name}`;
            if (t.codec) label += ` · ${t.codec}`;
            if (t.channels) label += ` ${t.channels}ch`;
            if (!t.playable) {
                label += ' ⚠';
                opt.className = 'unsupported';
            }
            opt.textContent = label;
            this.select.appendChild(opt);
        }
        this.select.value = String(this.currentIndex);
        this.updateInfoLabel();
    }

    updateInfoLabel() {
        const t = this.tracks[this.currentIndex];
        if (!t) { this.setInfo('—'); return; }
        let label = `Audio ${t.index + 1}`;
        const lang = langLabel(t.lang);
        if (lang) label += ` (${lang})`;
        if (t.codec) label += ` · ${t.codec}`;
        if (this.currentIndex !== this.defaultIndex) label += ' · extracted';
        this.setInfo(label);
    }

    cycleTrack() {
        if (this.tracks.length <= 1) return;
        const next = (this.currentIndex + 1) % this.tracks.length;
        if (this.select) this.select.value = String(next);
        this.onSelect(next);
    }

    async onSelect(index) {
        if (!this.tracks[index]) return;
        if (index === this.currentIndex) return;
        this.currentIndex = index;
        this.updateInfoLabel();

        if (this.nativeMode) {
            this.applyNative(index);
            return;
        }

        if (index === this.defaultIndex) {
            this.restoreNative();
            return;
        }

        const t = this.tracks[index];
        if (!t.playable) {
            this.osd(`⚠ ${t.codec || 'This codec'} 不能被瀏覽器解碼`);
            this.restoreNative();
            if (this.select) this.select.value = String(this.defaultIndex);
            this.currentIndex = this.defaultIndex;
            this.updateInfoLabel();
            return;
        }

        await this.extractAndSwitch(index);
    }

    // ---- Native switching (Safari / Firefox) ----
    applyNative(index) {
        const v = this.player.video;
        for (let i = 0; i < v.audioTracks.length; i++) {
            v.audioTracks[i].enabled = (i === index);
        }
        const t = this.tracks[index];
        this.osd(`🎵 ${t.codec || 'Track ' + (index + 1)}`);
        // Verify the change took effect; if not, fall back to extraction
        clearTimeout(this._nativeVerifyTimer);
        this._nativeVerifyTimer = setTimeout(() => {
            if (this.nativeMode && v.audioTracks[index] && !v.audioTracks[index].enabled) {
                console.warn('[Audio] native switch failed, falling back to extraction');
                this.nativeMode = false;
                this.extractAndSwitch(index);
            }
        }, 400);
    }

    // ---- Extraction switching (Chrome / Edge) ----
    async extractAndSwitch(index) {
        const token = ++this.extractToken;
        const t = this.tracks[index];

        if (this.blobCache.has(index)) {
            this.applyExtracted(index, this.blobCache.get(index).url);
            return;
        }

        this.showProgress(0, `🎵 萃取音軌 ${index + 1}…`);
        if (this.select) this.select.disabled = true;

        try {
            let blob;
            if (this.container === 'mkv' && t.mkvNumber) {
                const frames = await mkvExtractor.extractAudioTrack(this.file, t.mkvNumber, (p) => {
                    if (token === this.extractToken) this.showProgress(p, `🎵 萃取音軌 ${index + 1}… ${Math.round(p * 100)}%`);
                });
                if (token !== this.extractToken) return;
                if (frames.length === 0) throw new Error('未找到音軌數據');
                let data, mime;
                const codec = t.codec;
                if (codec === 'AAC') { data = wrapAACAdts(frames, t.raw.codecPrivate, t.raw.samplingFrequency, t.raw.channels); mime = 'audio/aac'; }
                else if (codec === 'MP3') { data = concatU8(frames.map(f => f.data)); mime = 'audio/mpeg'; }
                else if (codec === 'Opus') { data = wrapOggOpus(frames, t.raw.codecPrivate, t.raw.channels); mime = 'audio/ogg; codecs=opus'; }
                else if (codec === 'FLAC') { data = wrapFLAC(frames, t.raw.codecPrivate, t.raw.samplingFrequency, t.raw.channels, t.raw.bitDepth); mime = 'audio/flac'; }
                else if (codec === 'PCM') {
                    const isFloat = (t.raw.codecId || '').toUpperCase().indexOf('FLOAT') !== -1;
                    const big = (t.raw.codecId || '').toUpperCase().indexOf('BIG') !== -1;
                    if (big) throw new Error('big-endian PCM 未支援');
                    data = wrapWAV(frames, t.raw.channels, t.raw.samplingFrequency, t.raw.bitDepth, isFloat);
                    mime = 'audio/wav';
                } else {
                    throw new Error(`${codec} 未支援萃取`);
                }
                blob = new Blob([data], { type: mime });
            } else if (this.container === 'mp4' && t.mp4Trak) {
                if (!t.mp4Trak.stbl) throw new Error('MP4 結構不支援（fragmented?）');
                const m4a = await MP4AudioParser.extractTrack(this.file, t.mp4Trak, (p) => {
                    if (token === this.extractToken) this.showProgress(p, `🎵 萃取音軌 ${index + 1}… ${Math.round(p * 100)}%`);
                });
                if (token !== this.extractToken) return;
                blob = new Blob([m4a], { type: 'audio/mp4' });
            } else {
                throw new Error('容器不支援');
            }

            const url = URL.createObjectURL(blob);
            this.blobCache.set(index, { url });
            if (token !== this.extractToken) { URL.revokeObjectURL(url); return; }
            this.applyExtracted(index, url);
        } catch (err) {
            if (token !== this.extractToken) return;
            console.error('[Audio] extraction failed:', err);
            this.osd(`❌ 音軌萃取失敗: ${err.message}`);
            this.restoreNative();
            if (this.select) this.select.value = String(this.defaultIndex);
            this.currentIndex = this.defaultIndex;
            this.updateInfoLabel();
        } finally {
            if (token === this.extractToken) {
                this.hideProgress();
                if (this.select) this.select.disabled = false;
            }
        }
    }

    applyExtracted(index, url) {
        const v = this.player.video;
        v.muted = true;
        this.audioEl.volume = v.volume;
        this.audioEl.playbackRate = v.playbackRate;
        const start = () => {
            try { this.audioEl.currentTime = v.currentTime; } catch (e) { /* not seekable yet */ }
            if (!v.paused) this.audioEl.play().catch(() => {});
        };
        const onError = () => {
            console.error('[Audio] sink element failed to load extracted track');
            this.osd('❌ 播放萃取音軌失敗');
            this.restoreNative();
            if (this.select) this.select.value = String(this.defaultIndex);
            this.currentIndex = this.defaultIndex;
            this.updateInfoLabel();
        };
        this.audioEl.addEventListener('error', onError, { once: true });
        this.audioEl.addEventListener('loadedmetadata', () => {
            this.audioEl.removeEventListener('error', onError);
            start();
        }, { once: true });
        this.audioEl.src = url;
        const t = this.tracks[index];
        this.osd(`🎵 ${t.codec || 'Audio ' + (index + 1)}${t.lang ? ' · ' + langLabel(t.lang) : ''}`);
        this.updateInfoLabel();
    }

    restoreNative() {
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        this.audioEl.load();
        this.player.video.muted = false;
        this.osd('🎵 音軌 1（原生）');
        this.updateInfoLabel();
    }

    onVideoPlay() {
        if (this.audioEl.src && this.player.video.paused === false) {
            if (Math.abs(this.audioEl.currentTime - this.player.video.currentTime) > 0.5) {
                try { this.audioEl.currentTime = this.player.video.currentTime; } catch (e) { /* ignore */ }
            }
            this.audioEl.play().catch(() => {});
        }
    }

    syncAudioTime(force) {
        if (!this.audioEl.src) return;
        const v = this.player.video;
        const diff = Math.abs(this.audioEl.currentTime - v.currentTime);
        if (force || diff > 0.3) {
            try { this.audioEl.currentTime = v.currentTime; } catch (e) { /* ignore */ }
        }
    }

    driftCheck() {
        if (!this.audioEl.src) return;
        const v = this.player.video;
        if (v.paused || this.audioEl.paused) return;
        const diff = this.audioEl.currentTime - v.currentTime;
        if (Math.abs(diff) > 0.35) {
            try { this.audioEl.currentTime = v.currentTime; } catch (e) { /* ignore */ }
        }
    }

    showProgress(p, text) {
        if (!this.progressEl) {
            this.progressEl = document.createElement('div');
            this.progressEl.className = 'audio-extract-progress';
            const zone = this.player.dropZone;
            if (zone) zone.appendChild(this.progressEl);
        }
        if (this.progressEl) this.progressEl.textContent = text;
    }

    hideProgress() {
        if (this.progressEl && this.progressEl.parentNode) {
            this.progressEl.parentNode.removeChild(this.progressEl);
        }
        this.progressEl = null;
    }
}

const audioTracks = new AudioTrackManager(player);
