// Exercise streaming gzip beyond several 64 KiB buffer boundaries.
const char large_mapping[196609] __attribute__((
    section(".reassign_a"), used)) = {[0 ... 196607] = 'A', [196608] = '\0'};
