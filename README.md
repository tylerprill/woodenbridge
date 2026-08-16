# Field Atlas

Field Atlas is a personal travel journal for mapping the places that matter,
preserving photographs and field notes, and keeping a thoughtful record of
every journey.

## Features

- Secure account creation, email verification, login, and password recovery.
- A private personal-atlas dashboard with saved-place and field-note previews.
- Hierarchical user, administrator, and protected-owner access.
- Responsive, accessible interfaces across public and authenticated pages.
- Transactional account emails branded for Field Atlas.

## Installation

1. Clone the repository: `git clone https://github.com/username/wooded-bridge-app.git`
2. Install dependencies: `npm install`
3. Start the application: `npm start`

## Authentication

The full signup, email verification, login, session, password recovery, and
logout design is documented in the
[authentication README](docs/auth/README.md), including Mermaid flow and state
diagrams, route behavior, security controls, and a manual test checklist.

Authentication migrations create the email-verification, password-recovery,
login-limit, and signup-limit tables, along with the durable
`email_verified_at` and `session_version` user fields. Apply them before starting
the app:

```bash
npm run migrate:auth
```

Copy `.env.example` to an ignored local environment file and configure
`APP_URL`, `AUTH_SECRET`, and `DATABASE_URL`. Production email delivery uses
Resend and additionally requires `RESEND_API_KEY` plus a verified
`RESEND_FROM_EMAIL`. Local development may use console delivery for verification
codes and password-reset links.

## Usage

1. Open the app in your web browser.
2. Create an account and verify your email address.
3. Sign in to open your personal atlas.
4. Explore the current travel-memory previews and dashboard experience.

Interactive map pins, photo-backed travel entries, and editable field notes are
the next product milestone.

## Contributing

Contributions are welcome! If you have any ideas for new features, bug fixes, or improvements, please submit a pull request. Make sure to follow the existing code style and include relevant tests.

## License

This project is licensed under the [MIT License](LICENSE).

## Contact

For any questions or inquiries, please contact the project maintainer at [email@example.com](mailto:email@example.com).
