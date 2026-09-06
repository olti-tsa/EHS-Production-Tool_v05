export type AuthTestUser = {
  id: string;
  email: string;
};

export type AuthTestState = {
  employee: AuthTestUser;
  freelancer: AuthTestUser;
  unclassifiedExternal: AuthTestUser;
  staleEmployee: AuthTestUser;
};

export const AUTH_TEST_STATE_PATH = "/tmp/ehs-auth-role-e2e-users.json";