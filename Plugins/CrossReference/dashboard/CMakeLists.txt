# The dashboard is developed alongside its exporter, but Node is optional for
# builds that only need the C++ plugin. No npm packages or browser are required.
option(CROSSREFERENCE_BUILD_DASHBOARD
  "Build the CrossReference dashboard and expose its development checks" ON)
if(NOT CROSSREFERENCE_BUILD_DASHBOARD)
  return()
endif()
find_program(CROSSREFERENCE_DASHBOARD_NODE NAMES node nodejs
  DOC "Node.js 18 or newer for CrossReference dashboard builds and checks")
if(NOT CROSSREFERENCE_DASHBOARD_NODE)
  message(STATUS "CrossReference dashboard targets disabled: Node.js not found")
  return()
endif()
execute_process(
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" -p
    "Number(process.versions.node.split('.')[0])"
  RESULT_VARIABLE _node_status OUTPUT_VARIABLE _node_major
  OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
if(NOT _node_status EQUAL 0 OR NOT _node_major MATCHES "^[0-9]+$"
    OR _node_major LESS 18)
  message(STATUS "CrossReference dashboard targets disabled: Node.js 18 or newer required")
  return()
endif()

set(_dashboard_html "${CMAKE_CURRENT_BINARY_DIR}/image-anatomy.html")
set(_dashboard_sources src/page.html src/core.js src/relationships.js
  src/explorer.js src/ui.js tools/build.js)
add_custom_command(OUTPUT "${_dashboard_html}"
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tools/build.js" --out "${_dashboard_html}"
  DEPENDS ${_dashboard_sources}
  COMMENT "Building CrossReference image analysis dashboard"
  VERBATIM)
add_custom_target(CrossReferenceDashboard ALL DEPENDS "${_dashboard_html}")

add_custom_target(check-crossreference-dashboard
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check.js
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check-details.js
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check-relationships.js
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check-build.js
  DEPENDS CrossReferenceDashboard
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  USES_TERMINAL VERBATIM)

if(BUILD_TESTING)
  foreach(_check check check-details check-relationships check-build)
    add_test(NAME "CrossReferenceDashboard.${_check}"
      COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tools/${_check}.js")
  endforeach()
  if(ELD_STANDALONE AND TARGET CrossReference)
    set(_metadata_args)
    file(STRINGS "${ELD_INCLUDE_DIR}/LinkerWrapper.h" _metadata_api
      REGEX "^#define ELD_PLUGIN_HAS_IMAGE_METADATA +1")
    if(_metadata_api)
      list(APPEND _metadata_args --automatic-metadata)
    endif()
    eld_add_standalone_test(
      NAME CrossReferenceDashboard TARGET CrossReference
      SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/../test/dashboard_test.py"
      ARGS --node "${CROSSREFERENCE_DASHBOARD_NODE}"
        --output-dir "${CMAKE_CURRENT_BINARY_DIR}/exports" ${_metadata_args})
    add_dependencies(check-crossreference-dashboard CrossReference)
    add_custom_command(TARGET check-crossreference-dashboard POST_BUILD
      COMMAND "${CMAKE_CTEST_COMMAND}" --test-dir "${CMAKE_BINARY_DIR}"
        -C "$<CONFIG>" --output-on-failure
        -R "^ELDStandalone.CrossReferenceDashboard$"
      USES_TERMINAL VERBATIM)
  endif()
endif()

# The in-tree producer uses the new evaluated metadata APIs. The installed
# SDK fixture above also verifies the explicit region/root fallback.
if(NOT ELD_STANDALONE AND TARGET CrossReference AND TARGET ld.eld)
  find_package(Python3 QUIET COMPONENTS Interpreter)
  find_program(CROSSREFERENCE_DASHBOARD_CXX NAMES clang++)
  find_program(CROSSREFERENCE_DASHBOARD_CC NAMES clang)
  if(Python3_Interpreter_FOUND AND CROSSREFERENCE_DASHBOARD_CXX
      AND CROSSREFERENCE_DASHBOARD_CC)
    add_custom_target(CrossReferenceDashboardExportCheck
      COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../test/dashboard_test.py"
        --node "${CROSSREFERENCE_DASHBOARD_NODE}"
        --output-dir "${CMAKE_CURRENT_BINARY_DIR}/exports"
        --plugin-dir "$<TARGET_FILE_DIR:CrossReference>"
        --tools-dir "${LLVM_BINARY_DIR}"
        --library-dir "$<TARGET_FILE_DIR:LW>"
        --runtime-dir "$<TARGET_FILE_DIR:LW>"
        --target-cc "${CROSSREFERENCE_DASHBOARD_CC}"
        --target-cxx "${CROSSREFERENCE_DASHBOARD_CXX}"
        --target-ld "$<TARGET_FILE:ld.eld>"
        --target-triple "${ELD_DEFAULT_TARGET_TRIPLE}"
        --automatic-metadata
      DEPENDS CrossReference ld.eld
      USES_TERMINAL VERBATIM)
    add_dependencies(check-crossreference-dashboard CrossReferenceDashboardExportCheck)
  endif()
endif()
message(STATUS "CrossReference dashboard: ${_dashboard_html}")
