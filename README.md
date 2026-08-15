# Wooded Bridge App

The Wooded Bridge App is a web application that provides a platform for users to explore and discover various wooden bridges around the world. It aims to showcase the beauty and craftsmanship of these structures while also providing useful information for travelers and enthusiasts.

## Features

- Browse a collection of wooden bridges with detailed descriptions and photos.
- Search for bridges based on location, style, or other criteria.
- Save favorite bridges for future reference.
- Share bridges with others through social media or email.
- Get directions to bridges using integrated maps.

## Installation

1. Clone the repository: `git clone https://github.com/username/wooded-bridge-app.git`
2. Install dependencies: `npm install`
3. Start the application: `npm start`

## Password recovery

Password reset links are random, hashed at rest, single-use, and expire after
30 minutes. Apply the required database schema before starting the app:

```bash
npm run migrate:auth
```

Copy `.env.example` to `.env` and configure `APP_URL`, `AUTH_SECRET`, and
`DATABASE_URL`. Production email delivery uses Resend and additionally requires
`RESEND_API_KEY` plus a verified `RESEND_FROM_EMAIL`. Local development defaults
to console delivery; the reset URL appears only in the local server log.

## Usage

1. Open the app in your web browser.
2. Explore the collection of wooden bridges.
3. Use the search functionality to find specific bridges.
4. Save your favorite bridges by clicking the "Save" button.
5. Share bridges with others using the provided sharing options.
6. Get directions to a bridge by clicking the "Directions" button.

## Contributing

Contributions are welcome! If you have any ideas for new features, bug fixes, or improvements, please submit a pull request. Make sure to follow the existing code style and include relevant tests.

## License

This project is licensed under the [MIT License](LICENSE).

## Contact

For any questions or inquiries, please contact the project maintainer at [email@example.com](mailto:email@example.com).
