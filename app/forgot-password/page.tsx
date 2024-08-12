'use client';

import ForgotPasswordForm from '@/components/unclean/forgot-password-form';

export default function SignUp() {
  return (
    <>
      <div className="flex min-h-full flex-1 flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <img
            className="mx-auto h-10 w-auto"
            src="https://tailwindui.com/img/logos/mark.svg?color=indigo&shade=600"
            alt="Your Company"
          />
          <h2 className="mb-3 mt-6 text-center text-2xl font-bold leading-9 tracking-tight text-gray-900">
            Trouble Logging In?
          </h2>
          <p className="text-center">
            Enter your email address and we&apos;ll send you a link to get back
            into your account.
          </p>
        </div>

        <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px]">
          <div className=" bg-white px-6 py-8 shadow sm:rounded-lg sm:px-12">
            <button
              onClick={() => {
                if (window) {
                  window.history.back();
                }
              }}
              className="flex flex-row pb-4 text-indigo-600 hover:text-indigo-500"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24"
                viewBox="0 -960 960 960"
                width="18"
                fill="#4e46e5"
              >
                <path d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z" />
              </svg>
              <span className="pl-1 font-semibold text-indigo-600 hover:text-indigo-500">
                Back
              </span>
            </button>
            <ForgotPasswordForm />
          </div>
        </div>
      </div>
    </>
  );
}
