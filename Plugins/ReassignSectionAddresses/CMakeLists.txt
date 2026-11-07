set(SOURCES ReassignSectionAddresses.cpp)

find_package(ZLIB REQUIRED)

if(ELD_STANDALONE)
  eld_standalone_require_api(ReassignSectionAddresses LinkerWrapper.h
                              setSymbolAddress)
  eld_standalone_require_api(ReassignSectionAddresses LinkerWrapper.h claimUse)
  eld_standalone_require_api(ReassignSectionAddresses LinkerWrapper.h
                              isSymbolPreemptible)
  eld_add_standalone_plugin(ReassignSectionAddresses
    SOURCES ${SOURCES}
    LIBRARIES ZLIB::ZLIB)
  if(BUILD_TESTING AND ELD_ENABLE_LIT_TESTS)
    eld_add_standalone_plugin(ReassignSymbolMutation
      SOURCES test/Inputs/ReassignSymbolMutation.cpp)
    add_dependencies(ReassignSectionAddresses ReassignSymbolMutation)
  endif()
elseif(NOT CYGWIN AND LLVM_ENABLE_PIC)
  set(SHARED_LIB_SOURCES ${SOURCES})

  set(bsl ${BUILD_SHARED_LIBS})

  set(BUILD_SHARED_LIBS ON)

  add_llvm_library(ReassignSectionAddresses ${SHARED_LIB_SOURCES} LINK_LIBS LW
                   ZLIB::ZLIB)
  if(ELD_INCLUDE_TESTS)
    add_llvm_library(ReassignSymbolMutation
      test/Inputs/ReassignSymbolMutation.cpp LINK_LIBS LW)
    add_dependencies(ReassignSectionAddresses ReassignSymbolMutation)
  endif()

  set(BUILD_SHARED_LIBS ${bsl})
endif()

if(TARGET ReassignSectionAddresses)
  # Keep the example beside the plugin, including when only the config changes.
  add_custom_target(ReassignSectionAddressesConfig
    COMMAND ${CMAKE_COMMAND} -E make_directory
      "$<TARGET_FILE_DIR:ReassignSectionAddresses>"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${CMAKE_CURRENT_SOURCE_DIR}/ReassignSectionAddresses.yaml"
      "$<TARGET_FILE_DIR:ReassignSectionAddresses>/ReassignSectionAddresses.yaml"
    DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/ReassignSectionAddresses.yaml"
    COMMENT "Copying annotated ReassignSectionAddresses configuration"
    VERBATIM)
  add_dependencies(ReassignSectionAddresses ReassignSectionAddressesConfig)
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
