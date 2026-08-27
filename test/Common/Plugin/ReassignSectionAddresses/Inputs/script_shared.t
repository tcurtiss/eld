PHDRS {
  text PT_LOAD;
}

SECTIONS {
  /DISCARD/ : { *(.ARM.exidx*) }
  .text : { *(.text*) } :text
  .randomized_addrs (DSECT) : { KEEP(*(.randomized_addrs)) }
  .dynamic : { *(.dynamic) } :text
  .got : { *(.got) } :text
  .got.plt : { *(.got.plt) } :text
}
