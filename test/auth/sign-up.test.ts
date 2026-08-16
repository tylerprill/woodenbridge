import {
  createSignUpErrorState,
  signUpSchema,
  type SignUpInput,
} from '@/app/lib/auth/sign-up';

const mismatchedInput: SignUpInput = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'Ada.Lovelace@example.com',
  password: 'a-valid-signup-password',
  confirmPassword: 'a-different-valid-password',
};

describe('signup validation state', () => {
  it('rejects mismatched passwords on the server', () => {
    const result = signUpSchema.safeParse(mismatchedInput);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected signup validation to fail.');
    expect(
      result.error.issues.some(
        (issue) =>
          issue.path[0] === 'confirmPassword' &&
          issue.message === 'The passwords do not match.',
      ),
    ).toBe(true);
  });

  it('preserves names and email without retaining either password', () => {
    const state = createSignUpErrorState(
      undefined,
      mismatchedInput,
      'The passwords do not match.',
    );

    expect(state.fields).toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'Ada.Lovelace@example.com',
    });
    expect(state).not.toHaveProperty('password');
    expect(state).not.toHaveProperty('confirmPassword');
  });
});
