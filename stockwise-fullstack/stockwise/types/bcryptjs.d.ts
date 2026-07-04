declare module "bcryptjs" {
  export function hash(data: string, salt: number | string): Promise<string>;
  export function hash(data: string, salt: number | string, callback: (err: Error | null, hash: string) => void): void;
  export function compare(data: string, hash: string): Promise<boolean>;
  export function compare(data: string, hash: string, callback: (err: Error | null, same: boolean) => void): void;
  export function genSalt(rounds?: number): Promise<string>;
  export function genSalt(rounds: number, callback: (err: Error | null, salt: string) => void): void;
}
