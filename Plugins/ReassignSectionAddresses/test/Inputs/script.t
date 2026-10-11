SECTIONS {
  .reassign_a (DSECT) : { *(.reassign_a) }
  .reassign_b (DSECT) : { *(.reassign_b) }
  .text : { *(.text*) }
  .rodata : { *(.rodata*) }
  .data : { *(.data*) }
  .bss : { *(.bss*) *(COMMON) }
}
