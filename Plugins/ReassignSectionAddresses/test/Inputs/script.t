SECTIONS {
  .reassign_a (DSECT) : { *(.reassign_a) }
  .reassign_b (DSECT) : { *(.reassign_b) }
  .reassign_clean (DSECT) : { *(.reassign_clean) }
  .text : { *(.text*) }
  .rodata : { *(.rodata*) }
  .data : { *(.data*) }
  .bss : { *(.bss*) *(COMMON) }
}
