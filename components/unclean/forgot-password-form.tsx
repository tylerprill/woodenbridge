'use client';

import { useFormState } from 'react-dom';
import { createUser } from '@/app/lib/actions';

export default function ForgotPasswordForm() {
  const [errorMessage, dispatch] = useFormState(createUser, undefined);

  return (
    <form action={dispatch}>
      <label
        htmlFor="email"
        className="block text-sm font-medium leading-6 text-gray-900"
      >
        Email address
      </label>
      <div className="mt-2">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        />
      </div>

      <div className={'pt-6'}>
        <button
          type="submit"
          className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Send Login Link
        </button>
      </div>

      <div className="relative mt-10">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm font-medium leading-6">
          <span className="bg-white px-6 text-gray-900">OR</span>
        </div>
      </div>

      <div className="mt-6 text-center">
        <a
          href="/sign-up"
          className="font-semibold text-indigo-600 hover:text-indigo-500"
        >
          Create New Account
        </a>
      </div>

      <div>{errorMessage && <div className={'pt-4'}>{errorMessage}</div>}</div>
    </form>
  );
}
