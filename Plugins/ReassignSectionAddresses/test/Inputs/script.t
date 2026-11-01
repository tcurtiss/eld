SECTIONS {
  .reassign_a (DSECT) : { *(.reassign_a) }
  .reassign_b (DSECT) : { *(.reassign_b) }
  .reassign_clean (DSECT) : { *(.reassign_clean) }
  .reassign_trim (DSECT) : { *(.reassign_trim) }
  .reassign_csv (DSECT) : { *(.reassign_csv) }
  .reassign_bytes (DSECT) : { *(.reassign_bytes) }
  .reassign_empty (DSECT) : { *(.reassign_empty) }
  .text : { *(.text*) }
  .rodata : { *(.rodata*) }
  .data : { *(.data*) }
  .bss : { *(.bss*) *(COMMON) }
}
