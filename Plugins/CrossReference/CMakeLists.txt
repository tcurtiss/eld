set(SOURCES CrossReference.cpp)

if(ELD_STANDALONE)
  eld_add_standalone_plugin(CrossReference
    SOURCES ${SOURCES}
    LIBRARIES ZLIB::ZLIB)
elseif(NOT CYGWIN AND LLVM_ENABLE_PIC)
  set(SHARED_LIB_SOURCES ${SOURCES})

  set(bsl ${BUILD_SHARED_LIBS})

  set(BUILD_SHARED_LIBS ON)

  add_llvm_library(CrossReference ${SHARED_LIB_SOURCES} LINK_LIBS LW
                   ZLIB::ZLIB)

  set(BUILD_SHARED_LIBS ${bsl})
endif()

if(NOT ELD_STANDALONE)
  eld_register_plugin_tests(${CMAKE_CURRENT_SOURCE_DIR}/test CrossReference)
else()
  eld_add_standalone_test(
    NAME CrossReference
    TARGET CrossReference
    SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/test/standalone_test.py")
  eld_add_standalone_lit_test(
    NAME CrossReference
    TEST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/test")
endif()
