export interface Identity {
  email: string;
  name?: string;
}

/** Whatever we read headers off of: a `Request`'s `.headers`, or `next/headers`'s `headers()`. */
export type HeaderSource = Pick<Headers, "get">;
