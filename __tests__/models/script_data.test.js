/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import ScriptData from '../../src/models/script_data';
import { ParseScriptError } from '../../src/errors';
import buffer from 'buffer';
import { parseScriptData } from '../../src/utils/scripts';
import { OP_PUSHDATA1 } from '../../src/opcodes';

test('Script data', () => {
  const data = 'test';
  const scriptDataObj = new ScriptData(data);
  const scriptData = scriptDataObj.createScript();

  const parsedData = parseScriptData(scriptData);
  expect(parsedData.data).toBe(data);

  const bigData =
    'This is a big string that will push OP_PUSHDATA1 to stack before pushing the data itself.';
  const scriptBigDataObj = new ScriptData(bigData);
  const scriptBigData = scriptBigDataObj.createScript();

  // Assert that we have the PUSHDATA_1 in the script
  expect(scriptBigData[0]).toBe(OP_PUSHDATA1[0]);

  const parsedBigData = parseScriptData(scriptBigData);
  expect(parsedBigData.data).toBe(bigData);

  const wrongData = buffer.Buffer.from('a', 'utf-8');
  expect(() => {
    parseScriptData(wrongData);
  }).toThrowError(ParseScriptError);

  // Remove last element from scriptData (OP_CHECKSIG), then should fail
  const wrongData2 = scriptData.slice(scriptData.length - 1);
  expect(() => {
    parseScriptData(wrongData2);
  }).toThrowError(ParseScriptError);
});
