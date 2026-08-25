# Backend integration tests

This directory tests backend operator/process seams against real disposable dependencies. The
database suite owns and removes a digest-pinned PostGIS container, uses random test-only credentials,
and invokes the public npm preparation command rather than internal helpers.

Run it from the repository root with `PLACE_DATABASE_TEST_HOST` supplied by the test environment and
then `npm run test:database`; Docker is required. `npm run test:database-recovery` owns two disposable
runtimes and verifies database-level backup plus isolated restore, rotated credentials, spatial
contract recovery, runtime denial, and encrypted browser-session key recovery through the public
operator command.
