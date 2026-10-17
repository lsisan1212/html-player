// MKV Subtitle Extractor v2
// Parses MKV/Matroska files to extract embedded subtitle tracks
// Also provides audio track enumeration + extraction (for dual-audio switching)
class MKVSubtitleExtractor {
    constructor() {
        // EBML Element IDs (hex)
        this.EBML_HEADER = 0x1A45DFA3;
        this.SEGMENT = 0x18538067;
        this.SEGMENT_INFO = 0x1549A966;
        this.TIMECODE_SCALE = 0x2AD7B1;
        this.TRACKS = 0x1654AE6B;
        this.TRACK_ENTRY = 0xAE;
        this.TRACK_NUMBER = 0xD7;
        this.TRACK_TYPE = 0x83;
        this.TRACK_LANGUAGE = 0x22B59C;
        this.CODEC_ID = 0x86;
        this.NAME = 0x536E;
        this.CODEC_PRIVATE = 0x63A2;
        this.AUDIO_ELEMENT = 0xE1;
        this.VIDEO_ELEMENT = 0xE0;
        this.AUDIO_SAMPLING_FREQUENCY = 0xB5;
        this.AUDIO_CHANNELS = 0xE1;
        this.AUDIO_BIT_DEPTH = 0x6264;
        this.AUDIO_BLOCK_ALIGNMENT = 0x9F;
        this.CLUSTER = 0x1F43B675;
        this.CLUSTER_TIMECODE = 0xE7;
        this.SIMPLE_BLOCK = 0xA3;
        this.BLOCK_GROUP = 0xA0;
        this.BLOCK = 0xA1;
        this.BLOCK_DURATION = 0x9B;
        this.CODEC_DELAY = 0x56AA; // nanoseconds; ffmpeg subtracts it from block pts
    }

    async extractSubtitles(file) {
        console.log(`[MKV] === Starting extraction ===`);
        console.log(`[MKV] File: ${file.name}, Size: ${(file.size / 1024 / 1024).toFixed(1)} MB`);

        try {
            const parsed = await this.parseTracksHeader(file);
            if (!parsed) {
                console.log('[MKV] Not a valid MKV file (bad signature)');
                return [];
            }

            let timecodeScale = parsed.timecodeScale;
            const tracks = parsed.tracks;
            const clusterStart = parsed.clusterStart;

            console.log(`[MKV] TimecodeScale: ${timecodeScale}ns`);
            console.log(`[MKV] Parsed ${tracks.length} total track(s), ${tracks.filter(t => t.type === 17).length} subtitle(s)`);

            const subtitleTracks = tracks.filter(t => t.type === 17);

            if (subtitleTracks.length === 0) {
                console.log('[MKV] No subtitle tracks found in header');
                console.log('[MKV] All tracks:', tracks.map(t => `#${t.number} type=${t.type} codec=${t.codecId} lang=${t.language}`));
                return [];
            }

            if (clusterStart === -1) {
                console.log('[MKV] No clusters found in header');
                return [];
            }

            // Now extract subtitle data from the full file using chunked reading
            console.log(`[MKV] Extracting ${subtitleTracks.length} subtitle track(s)...`);
            console.log(`[MKV] First cluster at offset: ${clusterStart}`);

            // Read file in chunks to handle large files
            const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB per chunk
            const OVERLAP = 2 * 1024 * 1024; // 2MB overlap to find next cluster
            const MAX_SUBTITLES = 50000; // Reasonable max for a movie

            const results = subtitleTracks.map(track => ({
                trackNumber: track.number,
                language: track.language,
                name: track.name,
                codecId: track.codecId,
                subtitles: []
            }));

            let fileOffset = clusterStart;
            let totalClusters = 0;
            let chunkNum = 0;

            while (fileOffset < file.size && totalClusters < 5000) {
                const readStart = fileOffset;
                const readSize = Math.min(CHUNK_SIZE, file.size - fileOffset);
                const readEnd = readStart + readSize;

                console.log(`[MKV] Reading chunk ${chunkNum}: ${readStart} -> ${readEnd} (${(readSize / 1024 / 1024).toFixed(1)}MB)`);

                const chunkBuffer = await file.slice(readStart, readEnd).arrayBuffer();
                const chunkData = new Uint8Array(chunkBuffer);

                // Resync: find first Cluster magic bytes (1F 43 B6 75) in this chunk
                const syncOffset = this.findClusterSync(chunkData, 0, Math.min(chunkData.length, 1024 * 1024)); // Scan first 1MB
                const effectiveStart = syncOffset !== -1 ? syncOffset : 0;
                
                if (syncOffset !== -1 && syncOffset > 0) {
                    console.log(`[MKV] Resynced at chunk offset ${syncOffset} (file offset ${readStart + syncOffset})`);
                } else if (syncOffset === -1 && chunkNum > 0) {
                    console.log(`[MKV] WARNING: Could not resync cluster in this chunk, skipping`);
                    fileOffset = readEnd;
                    chunkNum++;
                    continue;
                }

                // Process this chunk for subtitle data
                const chunkResult = this.extractTrackSubtitlesFromChunk(
                    chunkData, effectiveStart, chunkData.length,
                    subtitleTracks, timecodeScale, MAX_SUBTITLES
                );

                totalClusters += chunkResult.clustersParsed;

                // Merge results into the results array
                for (const subEntry of chunkResult.subtitles) {
                    const result = results.find(r => r.trackNumber === subEntry.trackNumber);
                    if (result) {
                        result.subtitles.push(subEntry);
                    }
                }

                console.log(`[MKV] Chunk ${chunkNum}: ${chunkResult.clustersParsed} clusters, ${chunkResult.subtitles.length} new subtitles`);

                // Move to next chunk (with overlap to catch cluster boundaries)
                fileOffset = readEnd - OVERLAP;
                chunkNum++;

                // Stop if we didn't read a full chunk (reached end of file)
                if (readSize < CHUNK_SIZE) break;

                // Stop if we've collected enough subtitles
                const totalSubs = results.reduce((sum, r) => sum + r.subtitles.length, 0);
                if (totalSubs >= MAX_SUBTITLES) break;
            }

            // Sort subtitles by startTime and deduplicate
            for (const result of results) {
                result.subtitles.sort((a, b) => a.startTime - b.startTime);
                // Remove duplicates (same startTime + same text)
                const seen = new Set();
                result.subtitles = result.subtitles.filter(sub => {
                    const key = `${sub.startTime}-${sub.text.substring(0, 30)}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }

            // Filter out empty results
            const finalResults = results.filter(r => r.subtitles.length > 0);

            for (const result of finalResults) {
                console.log(`[MKV] Track #${result.trackNumber}: ${result.subtitles.length} subtitle entries`);
                if (result.subtitles.length > 0) {
                    const first = result.subtitles[0];
                    const last = result.subtitles[result.subtitles.length - 1];
                    console.log(`[MKV]   Time range: ${(first.startTime / 1000).toFixed(1)}s - ${(last.startTime / 1000).toFixed(1)}s`);
                }
            }

            console.log(`[MKV] === Extraction complete: ${totalClusters} clusters, ${finalResults.length} track(s) ===`);
            return finalResults;
        } catch (err) {
            console.error(`[MKV] Extraction error: ${err.message}`);
            console.error(err.stack);
            return [];
        }
    }

    // ===== Audio track support (dual-audio switching) =====

    // Parse only the header (EBML + SegmentInfo + Tracks) and locate first cluster.
    // Uses a sliding window so huge top-level elements (e.g. multi-MB Attachments)
    // between SegmentInfo and Clusters don't break the walk — we simply seek past them.
    async parseTracksHeader(file) {
        const WINDOW = 2 * 1024 * 1024;
        const TRACKS_LIMIT = 16 * 1024 * 1024; // Tracks element larger than this is pathological

        let win = new Uint8Array(await file.slice(0, Math.min(WINDOW, file.size)).arrayBuffer());
        let winBase = 0; // absolute file offset of win[0]

        if (win.length < 4 || win[0] !== 0x1A || win[1] !== 0x45 || win[2] !== 0xDF || win[3] !== 0xA3) {
            return null; // not MKV/WebM
        }

        // Ensure the window covers absolute range [absPos, absPos + need).
        // Re-reads a fresh window when the needed range falls outside the current one.
        const ensure = async (absPos, need) => {
            if (absPos >= winBase && absPos + need <= winBase + win.length) return true;
            const size = Math.min(Math.max(need, WINDOW), file.size - absPos);
            if (size < need) return false;
            win = new Uint8Array(await file.slice(absPos, absPos + size).arrayBuffer());
            winBase = absPos;
            return true;
        };

        let offset = 4;
        if (!(await ensure(offset, 12))) return null;
        const ebmlSize = this.readVarInt(win, offset - winBase);
        if (!ebmlSize) return null;
        offset += ebmlSize.length + ebmlSize.value;

        if (!(await ensure(offset, 16))) return null;
        const segId = this.readElementID(win, offset - winBase);
        if (!segId || segId.value !== this.SEGMENT) return null;
        offset += segId.length;

        const segSize = this.readVarInt(win, offset - winBase);
        if (!segSize) return null;
        offset += segSize.length;

        const UNKNOWN_SIZE = 0x01FFFFFFFFFFFFFF;
        const isUnknownSize = segSize.value === UNKNOWN_SIZE;

        let timecodeScale = 1000000;
        const tracks = [];
        let clusterStart = -1;
        const segmentEnd = isUnknownSize ? file.size : Math.min(offset + segSize.value, file.size);

        let scan = offset;
        while (scan < segmentEnd - 4) {
            if (!(await ensure(scan, 16))) break;
            const rel = scan - winBase;

            const elemId = this.readElementID(win, rel);
            if (!elemId) break;

            const elemSize = this.readVarInt(win, rel + elemId.length);
            if (!elemSize) break;

            const contentAbs = scan + elemId.length + elemSize.length;
            const elemEndAbs = contentAbs + elemSize.value;

            if (elemId.value === this.TIMECODE_SCALE && elemSize.value <= 8) {
                if (!(await ensure(contentAbs, elemSize.value))) break;
                timecodeScale = this.readUInt(win, contentAbs - winBase, elemSize.value);
            } else if (elemId.value === this.TRACKS) {
                const need = Math.min(elemSize.value, TRACKS_LIMIT);
                if (await ensure(contentAbs, need)) {
                    const endRel = Math.min(contentAbs - winBase + elemSize.value, win.length);
                    this.parseTracks(win, contentAbs - winBase, endRel, tracks);
                } else {
                    console.warn('[MKV] Tracks element too large to buffer, skipping');
                }
            } else if (elemId.value === this.CLUSTER) {
                clusterStart = scan;
                break;
            }

            // Seek to the next top-level element — huge elements (Attachments,
            // Cues, Tags...) are skipped without being read.
            scan = elemEndAbs;
        }

        return { tracks, timecodeScale, clusterStart, isWebM: false };
    }

    // List audio tracks (type=2) with codec info
    async enumerateAudioTracks(file) {
        const parsed = await this.parseTracksHeader(file);
        if (!parsed) return null;
        return parsed.tracks
            .filter(t => t.type === 2)
            .map(t => ({
                number: t.number,
                language: t.language,
                name: t.name,
                codecId: t.codecId,
                codecPrivate: t.codecPrivate,
                samplingFrequency: t.samplingFrequency,
                channels: t.channels,
                bitDepth: t.bitDepth
            }));
    }

    // Extract all frames of one audio track. Returns [{data: Uint8Array, pts: ms}]
    async extractAudioTrack(file, trackNumber, onProgress) {
        const parsed = await this.parseTracksHeader(file);
        if (!parsed || parsed.clusterStart === -1) return [];

        const { timecodeScale, clusterStart } = parsed;
        const frames = [];

        const CHUNK_SIZE = 64 * 1024 * 1024;
        const OVERLAP = 1 * 1024 * 1024;
        let fileOffset = clusterStart;
        let chunkNum = 0;

        while (fileOffset < file.size) {
            const readStart = fileOffset;
            const readSize = Math.min(CHUNK_SIZE, file.size - readStart);
            const chunkData = new Uint8Array(await file.slice(readStart, readStart + readSize).arrayBuffer());

            const syncOffset = this.findClusterSync(chunkData, 0, Math.min(chunkData.length, 1024 * 1024));
            const effectiveStart = syncOffset !== -1 ? syncOffset : 0;

            if (syncOffset === -1 && chunkNum > 0) {
                fileOffset = readStart + readSize;
                chunkNum++;
                continue;
            }

            let res = this.parseAudioChunk(chunkData, effectiveStart, chunkData.length, trackNumber, timecodeScale, frames);

            // Cluster straddling the chunk boundary: read the full cluster separately,
            // then continue with the rest of the chunk.
            while (res.truncated) {
                const cStart = readStart + res.start;
                const cEnd = Math.min(readStart + res.end, file.size);
                const clusterBuf = new Uint8Array(await file.slice(cStart, cEnd).arrayBuffer());
                const clusterTimecode = this.parseClusterTimecode(clusterBuf, 0, Math.min(512, clusterBuf.length));
                this.parseAudioBlocks(clusterBuf, 0, clusterBuf.length, trackNumber, timecodeScale, clusterTimecode, frames);
                const nextOff = res.end;
                if (nextOff >= chunkData.length) { res = { truncated: false }; break; }
                res = this.parseAudioChunk(chunkData, nextOff, chunkData.length, trackNumber, timecodeScale, frames);
            }

            if (onProgress) onProgress(Math.min(1, (readStart + readSize) / file.size));

            fileOffset = readStart + readSize - OVERLAP;
            chunkNum++;
            if (readSize < CHUNK_SIZE) break;
        }

        // CodecDelay (e.g. Opus pre-skip): ffmpeg demuxers subtract it from block
        // timestamps, rounding to whole ms (block timecodes are ms integers).
        // Apply the same shift so pts match ffmpeg's view of the timeline.
        const trackMeta = parsed.tracks.find(t => t.number === trackNumber);
        const delayMs = trackMeta && trackMeta.codecDelay ? Math.round(trackMeta.codecDelay / 1e6) : 0;
        if (delayMs > 0) {
            for (const f of frames) f.pts -= delayMs;
        }

        return frames;
    }

    // Parse clusters inside a chunk buffer; returns {truncated, start, end} if a
    // cluster extends past the chunk end.
    parseAudioChunk(uint8, offset, chunkEnd, trackNumber, timecodeScale, frames) {
        while (offset < chunkEnd - 4) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const sizeOffset = offset + elemId.length;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;

            const contentOffset = sizeOffset + elemSize.length;
            const elemEnd = contentOffset + elemSize.value;

            if (elemId.value === this.CLUSTER) {
                if (elemEnd > chunkEnd) {
                    return { truncated: true, start: offset, end: elemEnd };
                }
                const clusterTimecode = this.parseClusterTimecode(uint8, contentOffset, Math.min(contentOffset + 512, chunkEnd));
                this.parseAudioBlocks(uint8, contentOffset, Math.min(elemEnd, chunkEnd), trackNumber, timecodeScale, clusterTimecode, frames);
            }

            if (elemEnd > chunkEnd) break;
            offset = elemEnd;
        }
        return { truncated: false };
    }

    parseAudioBlocks(uint8, offset, end, trackNumber, timecodeScale, clusterTimecode, frames) {
        while (offset < end - 4) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const sizeOffset = offset + elemId.length;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;

            const contentOffset = sizeOffset + elemSize.length;
            const elemEnd = contentOffset + elemSize.value;

            if (elemId.value === this.SIMPLE_BLOCK) {
                this.parseAudioBlock(uint8, contentOffset, elemSize.value, trackNumber, timecodeScale, clusterTimecode, frames);
            } else if (elemId.value === this.BLOCK_GROUP) {
                this.parseBlockGroupForAudio(uint8, contentOffset, Math.min(elemEnd, end), trackNumber, timecodeScale, clusterTimecode, frames);
            }

            if (elemEnd > end) break;
            offset = elemEnd;
        }
    }

    parseBlockGroupForAudio(uint8, offset, end, trackNumber, timecodeScale, clusterTimecode, frames) {
        // Pre-scan for BlockDuration (comes after Block) so frames can carry it —
        // the last block of a stream may be shorter than its TOC suggests.
        let blockDurMs = null;
        {
            let scan = offset;
            while (scan < end - 4) {
                const elemId = this.readElementID(uint8, scan);
                if (!elemId) break;
                const elemSize = this.readVarInt(uint8, scan + elemId.length);
                if (!elemSize) break;
                const contentOffset = scan + elemId.length + elemSize.length;
                if (elemId.value === this.BLOCK_DURATION && elemSize.value <= 8) {
                    blockDurMs = (this.readUInt(uint8, contentOffset, elemSize.value) * timecodeScale) / 1e6;
                }
                scan = contentOffset + elemSize.value;
            }
        }

        while (offset < end - 4) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const sizeOffset = offset + elemId.length;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;

            const contentOffset = sizeOffset + elemSize.length;

            if (elemId.value === this.BLOCK) {
                this.parseAudioBlock(uint8, contentOffset, elemSize.value, trackNumber, timecodeScale, clusterTimecode, frames, blockDurMs);
            }

            offset = contentOffset + elemSize.value;
        }
    }

    parseAudioBlock(uint8, offset, size, trackNumber, timecodeScale, clusterTimecode, frames, blockDurMs) {
        if (size < 6) return;

        const trackNum = this.readVarInt(uint8, offset);
        if (!trackNum || trackNum.value !== trackNumber) return;

        const dataOffset = offset + trackNum.length;
        if (dataOffset + 3 > offset + size) return;

        const relTime = this.readInt16(uint8, dataOffset);
        const flags = uint8[dataOffset + 2];
        const laceType = (flags & 0x06) >> 1;
        const ptsMs = ((clusterTimecode + relTime) * timecodeScale) / 1000000;

        // Dedupe overlapping chunk rescans
        if (frames.length > 0 && ptsMs <= frames[frames.length - 1].pts) return;

        const payload = uint8.slice(dataOffset + 3, offset + size);
        const frameDatas = this.unlace(payload, laceType);
        const perFrameDur = blockDurMs != null && frameDatas.length > 1 ? blockDurMs / frameDatas.length : blockDurMs;
        for (const fd of frameDatas) {
            if (fd.length > 0) frames.push({ data: fd, pts: ptsMs, durMs: perFrameDur != null ? perFrameDur : null });
        }
    }

    // Split a laced block into individual frames
    unlace(payload, laceType) {
        if (laceType === 0 || payload.length === 0) return [payload];

        const n = payload[0] + 1; // number of frames in this lace
        if (n <= 1) return [payload.slice(1)];

        const frames = [];
        let p = 1;

        if (laceType === 1) {
            // Xiph lacing: (n-1) plain varints (0xFF = continue, +255)
            const sizes = [];
            for (let i = 0; i < n - 1; i++) {
                let v = 0;
                while (p < payload.length) {
                    const b = payload[p++];
                    v += b;
                    if (b !== 0xFF) break;
                }
                sizes.push(v);
            }
            let off = p;
            for (let i = 0; i < n - 1; i++) {
                frames.push(payload.slice(off, off + sizes[i]));
                off += sizes[i];
            }
            if (off < payload.length) frames.push(payload.slice(off));
        } else if (laceType === 2) {
            // Fixed-size lacing
            const sz = Math.floor((payload.length - 1) / n);
            let off = 1;
            for (let i = 0; i < n; i++) {
                frames.push(payload.slice(off, off + sz));
                off += sz;
            }
            if (off < payload.length) {
                const last = frames[frames.length - 1];
                const merged = new Uint8Array(last.length + (payload.length - off));
                merged.set(last);
                merged.set(payload.slice(off), last.length);
                frames[frames.length - 1] = merged;
            }
        } else if (laceType === 3) {
            // EBML lacing: first size is a full vint, rest are SIGNED vint deltas
            const sizes = [];
            const first = this.readVarInt(payload, p);
            if (!first) return [payload.slice(1)];
            p += first.length;
            let v = first.value;
            sizes.push(v);
            for (let i = 1; i < n - 1; i++) {
                const d = this.readVarInt(payload, p);
                if (!d) break;
                p += d.length;
                // Signed vint: the top bit of the value region is the sign
                const signBits = 7 * d.length - 1;
                const half = Math.pow(2, signBits);
                v += d.value >= half ? d.value - half * 2 : d.value;
                sizes.push(v);
            }
            let off = p;
            for (const s of sizes) {
                frames.push(payload.slice(off, off + s));
                off += s;
            }
            if (off < payload.length) frames.push(payload.slice(off));
        }

        return frames;
    }

    // Returns the START of the first Cluster element (not its content), so scans
    // begin exactly at a cluster boundary.
    findClusterOffset(uint8, startOffset, endOffset) {
        let offset = startOffset;
        while (offset < endOffset - 4) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;
            
            const idLen = elemId.length;
            const sizeOffset = offset + idLen;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;
            
            const contentOffset = sizeOffset + elemSize.length;
            
            if (elemId.value === this.CLUSTER) {
                return offset;
            }
            
            offset = contentOffset + elemSize.value;
        }
        return -1;
    }

    parseTracks(uint8, offset, end, tracks) {
        while (offset < end - 4) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;
            
            const idLen = elemId.length;
            const sizeOffset = offset + idLen;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;
            
            const contentOffset = sizeOffset + elemSize.length;
            const elemEnd = contentOffset + elemSize.value;

            if (elemId.value === this.TRACK_ENTRY) {
                const track = this.parseTrackEntry(uint8, contentOffset, Math.min(elemEnd, uint8.length));
                if (track) {
                    tracks.push(track);
                    console.log(`[MKV] Track #${track.number}: type=${track.type} codec=${track.codecId} lang=${track.language} name="${track.name}"`);
                }
            }

            offset = elemEnd;
        }
    }

    parseTrackEntry(uint8, offset, end) {
        const track = {
            number: 0,
            type: 0,
            language: 'und',
            codecId: '',
            name: '',
            codecPrivate: null,
            codecDelay: 0,
            samplingFrequency: 0,
            channels: 0,
            bitDepth: 0
        };

        while (offset < end - 2) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;
            
            const idLen = elemId.length;
            const sizeOffset = offset + idLen;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;
            
            const contentOffset = sizeOffset + elemSize.length;

            try {
                switch (elemId.value) {
                    case this.TRACK_NUMBER:
                        track.number = this.readUInt(uint8, contentOffset, elemSize.value);
                        break;
                    case this.TRACK_TYPE:
                        track.type = uint8[contentOffset];
                        break;
                    case this.TRACK_LANGUAGE:
                        track.language = this.readString(uint8, contentOffset, elemSize.value);
                        break;
                    case this.CODEC_ID:
                        track.codecId = this.readString(uint8, contentOffset, elemSize.value);
                        break;
                    case this.CODEC_DELAY:
                        track.codecDelay = this.readUInt(uint8, contentOffset, elemSize.value);
                        break;
                    case this.NAME:
                        track.name = this.readString(uint8, contentOffset, elemSize.value);
                        break;
                    case this.CODEC_PRIVATE:
                        track.codecPrivate = new Uint8Array(uint8.slice(contentOffset, contentOffset + elemSize.value));
                        break;
                    case this.AUDIO_ELEMENT:
                        // Audio settings are a nested master element
                        this.parseAudioEntry(uint8, contentOffset, Math.min(contentOffset + elemSize.value, uint8.length), track);
                        break;
                }
            } catch (e) {
                // Skip
            }

            offset = contentOffset + elemSize.value;
        }

        return track.type > 0 ? track : null;
    }

    parseAudioEntry(uint8, offset, end, track) {
        while (offset < end - 2) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const sizeOffset = offset + elemId.length;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;

            const contentOffset = sizeOffset + elemSize.length;

            try {
                switch (elemId.value) {
                    case this.AUDIO_SAMPLING_FREQUENCY:
                        track.samplingFrequency = this.readFloat(uint8, contentOffset, elemSize.value);
                        break;
                    case this.AUDIO_CHANNELS:
                        track.channels = this.readUInt(uint8, contentOffset, elemSize.value);
                        break;
                    case this.AUDIO_BIT_DEPTH:
                        track.bitDepth = this.readUInt(uint8, contentOffset, elemSize.value);
                        break;
                    case this.AUDIO_BLOCK_ALIGNMENT:
                        track.blockAlignment = this.readUInt(uint8, contentOffset, elemSize.value);
                        break;
                }
            } catch (e) {
                // Skip
            }

            offset = contentOffset + elemSize.value;
        }
    }

    readFloat(uint8, offset, length) {
        // Matroska floats: big-endian, 0/4/8 bytes
        if (length === 4) {
            const buf = new ArrayBuffer(4);
            const view = new DataView(buf);
            for (let i = 0; i < 4; i++) view.setUint8(i, uint8[offset + i]);
            return view.getFloat32(0, false);
        }
        if (length === 8) {
            const buf = new ArrayBuffer(8);
            const view = new DataView(buf);
            for (let i = 0; i < 8; i++) view.setUint8(i, uint8[offset + i]);
            return view.getFloat64(0, false);
        }
        return this.readUInt(uint8, offset, length);
    }

    findClusterSync(uint8, start, end) {
        // Cluster element ID: 0x1F43B675
        // In EBML encoding: 1F 43 B6 75
        const magic = [0x1F, 0x43, 0xB6, 0x75];
        
        for (let i = start; i < end - 4; i++) {
            if (uint8[i] === magic[0] &&
                uint8[i + 1] === magic[1] &&
                uint8[i + 2] === magic[2] &&
                uint8[i + 3] === magic[3]) {
                return i;
            }
        }
        return -1;
    }

    extractTrackSubtitlesFromChunk(uint8, offset, chunkEnd, subtitleTracks, timecodeScale, maxSubtitles) {
        const results = [];
        let clusterTimecode = 0;
        let clustersParsed = 0;

        while (offset < chunkEnd - 4 && clustersParsed < 2000) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const idLen = elemId.length;
            const sizeOffset = offset + idLen;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;

            const contentOffset = sizeOffset + elemSize.length;
            const elemEnd = contentOffset + elemSize.value;

            if (elemId.value === this.CLUSTER) {
                // Parse cluster timecode — if not found, use 0 (relative timestamps still work)
                clusterTimecode = this.parseClusterTimecode(uint8, contentOffset, Math.min(contentOffset + 512, chunkEnd));

                // Parse blocks for subtitle tracks
                this.parseBlocksForSubtitles(uint8, contentOffset, Math.min(elemEnd, chunkEnd),
                    subtitleTracks, results, clusterTimecode, timecodeScale, maxSubtitles);

                clustersParsed++;
            }

            offset = elemEnd;

            // Stop if we've collected enough
            if (results.length >= maxSubtitles) break;
        }

        return { subtitles: results, clustersParsed };
    }

    parseBlocksForSubtitles(uint8, offset, end, subtitleTracks, results, clusterTimecode, timecodeScale, maxSubtitles) {
        while (offset < end - 4 && results.length < maxSubtitles) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const idLen = elemId.length;
            const sizeOffset = offset + idLen;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;

            const contentOffset = sizeOffset + elemSize.length;

            if (elemId.value === this.SIMPLE_BLOCK) {
                this.parseSubtitleBlock(uint8, contentOffset, elemSize.value,
                    subtitleTracks, results, clusterTimecode, timecodeScale);
            } else if (elemId.value === this.BLOCK_GROUP) {
                this.parseBlockGroupForSubtitles(uint8, contentOffset, elemSize.value,
                    subtitleTracks, results, clusterTimecode, timecodeScale);
            }

            offset = contentOffset + elemSize.value;
        }
    }

    parseBlockGroupForSubtitles(uint8, offset, size, subtitleTracks, results, clusterTimecode, timecodeScale) {
        const end = offset + size;
        while (offset < end - 4) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const idLen = elemId.length;
            const sizeOffset = offset + idLen;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize) break;

            const contentOffset = sizeOffset + elemSize.length;

            if (elemId.value === this.BLOCK) {
                this.parseSubtitleBlock(uint8, contentOffset, elemSize.value,
                    subtitleTracks, results, clusterTimecode, timecodeScale);
            }

            offset = contentOffset + elemSize.value;
        }
    }

    parseSubtitleBlock(uint8, offset, size, subtitleTracks, results, clusterTimecode, timecodeScale) {
        if (size < 6) return;

        const trackNum = this.readVarInt(uint8, offset);
        if (!trackNum) return;

        // Check if this track is one of our subtitle tracks
        const track = subtitleTracks.find(t => t.number === trackNum.value);
        if (!track) return;

        const dataOffset = offset + trackNum.length;
        if (dataOffset + 3 > offset + size) return;

        const blockTimecode = this.readInt16(uint8, dataOffset);

        // Calculate absolute timecode in milliseconds
        const absoluteTimecodeMs = ((clusterTimecode + blockTimecode) * timecodeScale) / 1000000;

        // MKV SimpleBlock header after track number: 2 bytes timecode + 1 byte flags = 3 bytes
        const subtitleData = uint8.slice(dataOffset + 3, offset + size);

        try {
            const text = this.decodeText(subtitleData, track.codecId);
            if (text && text.trim()) {
                results.push({
                    trackNumber: track.number,
                    startTime: absoluteTimecodeMs,
                    text: text,
                    codecId: track.codecId
                });
            }
        } catch (e) {
            // Skip
        }
    }

    parseClusterTimecode(uint8, offset, end) {
        const scanEnd = Math.min(offset + 512, end); // Scan up to 512 bytes for timecode
        while (offset < scanEnd - 4) {
            const elemId = this.readElementID(uint8, offset);
            if (!elemId) break;

            const idLen = elemId.length;
            const sizeOffset = offset + idLen;
            const elemSize = this.readVarInt(uint8, sizeOffset);
            if (!elemSize || elemSize.value > 8) break;

            const contentOffset = sizeOffset + elemSize.length;

            if (elemId.value === this.CLUSTER_TIMECODE) {
                const tc = this.readUInt(uint8, contentOffset, elemSize.value);
                return tc;
            }

            if (elemId.value === this.SIMPLE_BLOCK || elemId.value === this.BLOCK_GROUP || elemId.value === this.BLOCK) {
                break;
            }

            offset = contentOffset + elemSize.value;
        }
        return 0;
    }

    decodeText(data, codecId) {
        try {
            // Try UTF-8 first
            let text = this._tryDecode(data, 'utf-8');
            
            // If UTF-8 produced replacement characters, try GBK (common for Chinese subtitles)
            if (text && /[\ufffd]/.test(text)) {
                text = this._tryDecode(data, 'gbk');
            }
            
            // If GBK also failed, try GB18030 (superset of GBK)
            if (text && /[\ufffd]/.test(text)) {
                text = this._tryDecode(data, 'gb18030');
            }

            if (codecId.includes('S_TEXT/ASS') || codecId.includes('S_SSA')) {
                // ASS/SSA format in MKV SimpleBlock can be:
                // 1) "Dialogue: 0,0:00:07.07,0:00:08.07,Default,,0,0,0,,{\an8}Hello"
                // 2) "0,0:00:07.07,0:00:08.07,Default,,0,0,0,,{\an8}Hello" (no prefix)
                // Fields: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
                
                // Strip "Dialogue: " prefix if present
                if (text.startsWith('Dialogue:')) {
                    text = text.substring(9).trim();
                }

                // Now skip first 8 comma-separated fields to get the actual text
                // ASS format: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
                // That's 9 fields separated by 8 commas
                let commaCount = 0;
                let textStart = -1;
                for (let i = 0; i < text.length; i++) {
                    if (text[i] === ',') {
                        commaCount++;
                        if (commaCount === 8) {
                            textStart = i + 1;
                            break;
                        }
                    }
                }

                if (textStart !== -1) {
                    text = text.substring(textStart).trim();
                } else {
                    // Not enough commas — probably not a valid dialogue line
                    return null;
                }

                // Remove ASS drawing commands: everything between {\p1} and {\p0}
                text = text.replace(/\{\\p\d+\}[\s\S]*?\{\\p0\}/g, '');

                // Remove ASS override tags: {\an8}, {\pos(100,200)}, {\b1}, {\c&H000000&}, etc.
                text = text.replace(/\{[^}]*\}/g, '').trim();

                // Convert ASS newlines (\N or \n) to actual text newlines
                text = text.replace(/\\[Nn]/g, '\n');

                // Remove pure drawing commands (standalone vector paths)
                if (/^[mlbcn\s\d\-\.]+$/.test(text)) {
                    return null;
                }
            }

            return text && text.trim() ? text : null;
        } catch (e) {
            return null;
        }
    }

    _tryDecode(data, encoding) {
        try {
            const decoder = new TextDecoder(encoding, { fatal: true });
            return decoder.decode(data);
        } catch (e) {
            // Try non-fatal decode (replaces invalid bytes)
            try {
                const decoder = new TextDecoder(encoding);
                return decoder.decode(data);
            } catch (e2) {
                return null;
            }
        }
    }

    // EBML variable-size integer — handles up to 8 bytes using Number (safe up to 2^53)
    readVarInt(uint8, offset) {
        if (offset >= uint8.length) return null;
        
        const firstByte = uint8[offset];
        if (firstByte === 0) return null;

        let mask = 0x80;
        let length = 1;
        while ((firstByte & mask) === 0 && length < 8) {
            mask >>= 1;
            length++;
        }

        // Use Number arithmetic (safe up to 2^53, enough for EBML)
        let value = firstByte & (mask - 1);
        for (let i = 1; i < length; i++) {
            if (offset + i >= uint8.length) return null;
            value = value * 256 + uint8[offset + i];
        }

        return { value, length };
    }

    // EBML element ID (1-4 bytes)
    readElementID(uint8, offset) {
        if (offset >= uint8.length) return null;
        
        const firstByte = uint8[offset];
        if (firstByte === 0) return null;

        let length, value;
        if ((firstByte & 0x80) !== 0) {
            length = 1;
            value = firstByte;
        } else if ((firstByte & 0xC0) === 0x40) {
            length = 2;
            if (offset + 1 >= uint8.length) return null;
            value = (firstByte << 8) | uint8[offset + 1];
        } else if ((firstByte & 0xE0) === 0x20) {
            length = 3;
            if (offset + 2 >= uint8.length) return null;
            value = (firstByte << 16) | (uint8[offset + 1] << 8) | uint8[offset + 2];
        } else if ((firstByte & 0xF0) === 0x10) {
            length = 4;
            if (offset + 3 >= uint8.length) return null;
            value = (firstByte << 24) | (uint8[offset + 1] << 16) | (uint8[offset + 2] << 8) | uint8[offset + 3];
        } else {
            return null;
        }

        return { value, length };
    }

    readUInt(uint8, offset, length) {
        let value = 0;
        for (let i = 0; i < length && i < 8; i++) {
            value = value * 256 + uint8[offset + i];
        }
        return value;
    }

    readInt16(uint8, offset) {
        const val = (uint8[offset] << 8) | uint8[offset + 1];
        return val >= 0x8000 ? val - 0x10000 : val;
    }

    readString(uint8, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            const ch = uint8[offset + i];
            if (ch === 0) break;
            str += String.fromCharCode(ch);
        }
        return str;
    }
}

const mkvExtractor = new MKVSubtitleExtractor();
