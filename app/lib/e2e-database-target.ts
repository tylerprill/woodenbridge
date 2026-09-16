const DEFAULT_E2E_DATABASE_NAME = 'field_atlas_e2e';
const LIFECYCLE_E2E_DATABASE_NAME = 'field_atlas_e2e_lifecycle';
const LIFECYCLE_E2E_EMAIL = 'field-atlas-lifecycle-e2e@example.test';

export function getExpectedE2EDatabaseName(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const ownsLifecycleFixture =
    environment.E2E_REQUIRE_LIFECYCLE === '1' &&
    environment.E2E_LIFECYCLE_DATABASE_SEED === '1' &&
    environment.E2E_LIFECYCLE_TEST_EMAIL === LIFECYCLE_E2E_EMAIL;

  return ownsLifecycleFixture
    ? LIFECYCLE_E2E_DATABASE_NAME
    : DEFAULT_E2E_DATABASE_NAME;
}
