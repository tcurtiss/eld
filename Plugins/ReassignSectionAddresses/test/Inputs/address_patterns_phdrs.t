PHDRS {
  code PT_LOAD FLAGS(5);
  data PT_LOAD FLAGS(6);
  dynamic PT_DYNAMIC FLAGS(6);
}
SECTIONS {
  . = 0x42000000;
  .dynsym : { *(.dynsym) } :code
  .dynstr : { *(.dynstr) } :code
  .hash : { *(.hash) } :code
  .text ALIGN(0x1000) : { *(.text*) } :code
  .rodata ALIGN(64) : { *(.rodata*) } :code
  .dynamic ALIGN(0x1000) : { *(.dynamic) } :data :dynamic
  .got : { *(.got*) } :data
  .data : { *(.data*) } :data
  .dedup 0 (DSECT) : { *(.dedup) } :NONE
  .dedup_aux 0 (DSECT) : { *(.dedup_aux) } :NONE
}
