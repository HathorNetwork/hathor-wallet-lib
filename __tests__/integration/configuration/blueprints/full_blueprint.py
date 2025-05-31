#
# Copyright (c) Hathor Labs and its affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#

from typing import Optional

from hathor.nanocontracts.blueprint import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.exception import NCFail
from hathor.nanocontracts.types import (
    Address,
    Amount,
    BlueprintId,
    ContractId,
    NCDepositAction,
    NCWithdrawalAction,
    SignedData,
    Timestamp,
    TokenUid,
    TxOutputScript,
    VertexId,
    public,
    view,
)


class FullBlueprint(Blueprint):
    vertex: VertexId

    amount: Amount

    address: Address

    tx_output_script: TxOutputScript

    token_uid: TokenUid

    timestamp: Timestamp

    contract_id: ContractId

    blueprint_id: BlueprintId

    #varint: VarInt

    attr_str: str

    attr_int: int

    attr_bytes: bytes

    attr_bool: bool

    #attr_tuple: tuple[int]

    #attr_set: set[str]

    #attr_list: list[bytes]

    attr_dict_address: dict[Address, Amount]

    attr_dict_bytes: dict[bytes, int]

    attr_dict_str: dict[str, dict[str, int]]

    attr_dict_str_bytes: dict[str, dict[bytes, int]]

    attr_optional: Optional[str]

    attr_random_list: list[str]

    random_value: str

    @public
    def initialize(self, ctx: Context, vertex: VertexId, amount: Amount,
                   address: Address, tx_output_script: TxOutputScript,
                   token_uid: TokenUid, timestamp: Timestamp, contract_id: ContractId,
                   blueprint_id: BlueprintId, attr_str: str,
                   attr_int: int, attr_bytes: bytes, attr_bool: bool) -> None:

        self.vertex = vertex
        self.amount = amount
        self.address = address
        self.tx_output_script = tx_output_script
        self.token_uid = token_uid
        self.timestamp = timestamp
        self.contract_id = contract_id
        self.blueprint_id = blueprint_id
        #self.varint = varint
        self.attr_str = attr_str
        self.attr_int = attr_int
        self.attr_bytes = attr_bytes
        self.attr_bool = attr_bool
        self.attr_optional = None

    @public
    def set_optional(self, ctx: Context, value: Optional[str]) -> None:
        self.attr_optional = value

    @public
    def set_dict_address(self, ctx: Context, key: Address, value: Amount) -> None:
        self.attr_dict_address[key] = value
 
    @public
    def set_dict_bytes(self, ctx: Context, key: bytes, value: int) -> None:
        self.attr_dict_bytes[key] = value
 
    @public
    def set_dict_str_int(self, ctx: Context, key: str, key2: str, value: int) -> None:
        self.attr_dict_str[key] = {key2: value}
 
    @public
    def set_dict_str_bytes_int(self, ctx: Context, key: str, key2: bytes, value: int) -> None:
        self.attr_dict_str_bytes[key] = {key2: value}

    @public
    def append_str(self, ctx: Context, item: str) -> None:
        self.attr_random_list.append(item)

    @public
    def set_random_value(self, ctx: Context) -> None:
        # I tried creating a view method to return this random value
        # but a view method does not have access to the rng object
        # so I'm storing the random value, so we can read it
        idx = self.syscall.rng.randint(0, len(self.attr_random_list) - 1)
        self.random_value = self.attr_random_list[idx]

    @view
    def is_attr_optional_filled(self) -> bool:
        return self.attr_optional is not None
 

__blueprint__ = FullBlueprint