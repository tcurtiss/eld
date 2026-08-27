PHDRS {
  text PT_LOAD;
}

SECTIONS {
  /DISCARD/ : { *(.ARM.exidx*) }
  .text : { *(.text*) } :text
  .randomized_addrs (DSECT) : { KEEP(*(.randomized_addrs)) }
  .randomized_addrs2 (DSECT) : { KEEP(*(.randomized_addrs2)) }
}
