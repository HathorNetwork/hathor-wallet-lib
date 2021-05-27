import assert from 'assert';
import buffer from 'buffer';

const isHexa = (value: string): boolean => {
  // test if value is string?
  return /^[0-9a-fA-F]*$/.test(value);
};

export const hexToBuffer = (value: string): Buffer => {
  assert(isHexa(value));
  return Buffer.from(value, 'hex');
};
