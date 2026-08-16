export type User = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  email_verified_at: Date | null;
};

export type NewUser = Omit<User, 'id' | 'email_verified_at'>;
