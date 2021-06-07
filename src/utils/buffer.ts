import assert from 'assert';
import buffer from 'buffer';

const isHexa = (value: string): boolean => {
  // test if value is string?
  return /^[0-9a-fA-F]*$/.test(value);
};

export const hexToBuffer = (value: string): Buffer => {
  if (!isHexa(value)) {
    throw new Error("hexToBuffer: argument must be a strict hex string.");
  }
  return Buffer.from(value, 'hex');
};
