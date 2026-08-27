PLUGIN_OUTPUT_SECTION_ITER("ReassignSectionAddresses", "ReassignSectionAddresses", "section=.randomized_addrs:hash=sequential:start=100")

PHDRS {
  text PT_LOAD;
}

SECTIONS {
  /DISCARD/ : { *(.ARM.exidx*) }
  .text : { *(.text*) } :text
  .randomized_addrs (DSECT) : { KEEP(*(.randomized_addrs)) }
}
