TEXT_BASE = DEFINED(TEXT_BASE) ? TEXT_BASE : 0x10000;
SECTIONS {
  .text TEXT_BASE : { *(.text*) }
  .rodata : { *(.rodata*) }
  .dedup (DSECT) : { *(.dedup) }
  .dedup_aux (DSECT) : { *(.dedup_aux) }
}
