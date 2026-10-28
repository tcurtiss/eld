# -Oz may outline the callee-save restore sequence. Supply the actual helper
# needed by these fixtures so the test does not depend on a target runtime.
.text
.globl __restore_r16_through_r17_and_deallocframe_before_tailcall
.hidden __restore_r16_through_r17_and_deallocframe_before_tailcall
.type __restore_r16_through_r17_and_deallocframe_before_tailcall,@function
__restore_r16_through_r17_and_deallocframe_before_tailcall:
  {
    r17:16 = memd(r30+#-8)
    deallocframe
    jumpr r31
  }
.size __restore_r16_through_r17_and_deallocframe_before_tailcall, .-__restore_r16_through_r17_and_deallocframe_before_tailcall
