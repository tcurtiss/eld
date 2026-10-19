SECTIONS {
  .text : { KEEP(*(.text.keepme)) *(.text*) }
  .rodata : { *(.rodata*) }
  .sdata : {
    PROVIDE (_SDA_BASE_ = .);
    *(.sdata*) *(.sbss*)
  }
  .data : { *(.data*) }
  .bss : { *(.bss*) *(COMMON) }
}
