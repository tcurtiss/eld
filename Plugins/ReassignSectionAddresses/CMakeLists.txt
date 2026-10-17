set(SOURCES ReassignSectionAddresses.cpp)

find_package(ZLIB REQUIRED)

if(ELD_STANDALONE)
  eld_standalone_require_api(ReassignSectionAddresses LinkerWrapper.h
                              setSymbolAddress)
  eld_add_standalone_plugin(ReassignSectionAddresses
    SOURCES ${SOURCES}
    LIBRARIES ZLIB::ZLIB)
elseif(NOT CYGWIN AND LLVM_ENABLE_PIC)
  set(SHARED_LIB_SOURCES ${SOURCES})

  set(bsl ${BUILD_SHARED_LIBS})

  set(BUILD_SHARED_LIBS ON)

  add_llvm_library(ReassignSectionAddresses ${SHARED_LIB_SOURCES} LINK_LIBS LW
                   ZLIB::ZLIB)

  set(BUILD_SHARED_LIBS ${bsl})
endif()

if(NOT ELD_STANDALONE)
  eld_register_plugin_tests(${CMAKE_CURRENT_SOURCE_DIR}/test
                            ReassignSectionAddresses)
elseif(BUILD_TESTING)
  eld_add_standalone_test(
    NAME ReassignSectionAddresses
    TARGET ReassignSectionAddresses
    SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/test/standalone_test.py")
  eld_add_standalone_lit_test(
    NAME ReassignSectionAddresses
    TARGET ReassignSectionAddresses
    TEST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/test")
endif()
