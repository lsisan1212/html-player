// MKV Subtitle Extractor v2
// Parses MKV/Matroska files to extract embedded subtitle tracks
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
        this.CLUSTER = 0x1F43B675;
        this.CLUSTER_TIMECODE = 0xE7;
        this.SIMPLE_BLOCK = 0xA3;
        this.BLOCK_GROUP = 0xA0;
        this.BLOCK = 0xA1;
        this.BLOCK_DURATION = 0x9B;
    }

    async extractSubtitles(file) {
        console.log(`[MKV] === Starting extraction ===`);
        console.log(`[MKV] File: ${file.name}, Size: ${(file.size / 1024 / 1024).toFixed(1)} MB`);
        
        try {
            // Read first 2MB for header/tracks, then stream clusters
            const headerBuffer = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
            const header = new Uint8Array(headerBuffer);
            
            // Verify MKV signature
            if (header[0] !== 0x1A || header[1] !== 0x45 || header[2] !== 0xDF || header[3] !== 0xA3) {
                console.log('[MKV] Not a valid MKV file (bad signature)');
                return [];
            }

            let offset = 4;
            
            // Skip EBML header
            const ebmlSize = this.readVarInt(header, offset);
            if (!ebmlSize) { console.log('[MKV] Failed to read EBML header size'); return []; }
            offset += ebmlSize.length + ebmlSize.value;
            console.log(`[MKV] EBML header OK, offset now: ${offset}`);

            // Find segment
            const segId = this.readElementID(header, offset);
            if (!segId) { console.log('[MKV] Failed to read segment ID'); return []; }
            console.log(`[MKV] Segment ID: 0x${segId.value.toString(16).toUpperCase()}`);
            
            if (segId.value !== this.SEGMENT) {
                console.log('[MKV] No segment found');
                return [];
            }
            offset += segId.length;
            
            const segSize = this.readVarInt(header, offset);
            if (!segSize) { console.log('[MKV] Failed to read segment size'); return []; }
            offset += segSize.length;
            
            // 0x01FFFFFFFFFFFFFF = unknown size (read until EOF)
            const UNKNOWN_SIZE = 0x01FFFFFFFFFFFFFF;
            const isUnknownSize = segSize.value === UNKNOWN_SIZE;
            
            if (isUnknownSize) {
                console.log(`[MKV] Segment size: unknown (will read full file)`);
            } else {
                console.log(`[MKV] Segment size: ${segSize.value}`);
            }

            // Parse header elements (SegmentInfo + Tracks)
            let timecodeScale = 1000000; // Default 1ms in nanoseconds
            const tracks = [];
            let scanOffset = offset;
            let foundCluster = false;
            const segmentEnd = isUnknownSize ? header.length : Math.min(offset + segSize.value, header.length);

            while (scanOffset < segmentEnd && scanOffset < header.length - 4 && !foundCluster) {
                const elemId = this.readElementID(header, scanOffset);
                if (!elemId) break;
                
                const idLen = elemId.length;
                const sizeOffset = scanOffset + idLen;
                const elemSize = this.readVarInt(header, sizeOffset);
                if (!elemSize) break;
                
                const contentOffset = sizeOffset + elemSize.length;
                const elemEnd = contentOffset + elemSize.value;

                if (elemId.value === this.TIMECODE_SCALE && elemSize.value <= 8) {
                    timecodeScale = this.readUInt(header, contentOffset, elemSize.value);
                    console.log(`[MKV] TimecodeScale: ${timecodeScale}ns`);
                }

                if (elemId.value === this.TRACKS) {
                    console.log(`[MKV] Found Tracks element at ${scanOffset}`);
                    this.parseTracks(header, contentOffset, Math.min(elemEnd, header.length), tracks);
                    console.log(`[MKV] Parsed ${tracks.length} total track(s), ${tracks.filter(t => t.type === 17).length} subtitle(s)`);
                }

                if (elemId.value === this.CLUSTER) {
                    foundCluster = true;
                    console.log(`[MKV] Found first Cluster at ${scanOffset}`);
                }

                scanOffset = elemEnd;
            }

            const subtitleTracks = tracks.filter(t => t.type === 17);
            
            if (subtitleTracks.length === 0) {
                console.log('[MKV] No subtitle tracks found in header');
                console.log('[MKV] All tracks:', tracks.map(t => `#${t.number} type=${t.type} codec=${t.codecId} lang=${t.language}`));
                return [];
            }

            // Now extract subtitle data from the full file using chunked reading
            console.log(`[MKV] Extracting ${subtitleTracks.length} subtitle track(s)...`);

            // Find cluster start offset from header
            const headerEnd = Math.min(offset + 2 * 1024 * 1024, header.length);
            const clusterOffset = this.findClusterOffset(header, offset, headerEnd);
            if (clusterOffset === -1) {
                console.log('[MKV] No clusters found in header');
                return [];
            }

            console.log(`[MKV] First cluster at offset: ${clusterOffset}`);

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

            let fileOffset = clusterOffset;
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
                return contentOffset;
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
            name: ''
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
                        track.number = uint8[contentOffset];
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
                    case this.NAME:
                        track.name = this.readString(uint8, contentOffset, elemSize.value);
                        break;
                }
            } catch (e) {
                // Skip
            }

            offset = contentOffset + elemSize.value;
        }

        return track.type > 0 ? track : null;
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
