#
# Copyright (c) Hathor Labs and its affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#

from typing import Optional

from hathor import (
    Blueprint,
    Context,
    Address,
    Amount,
    BlueprintId,
    ContractId,
    NCDepositAction,
    NCFail,
    NCWithdrawalAction,
    SignedData,
    Timestamp,
    TokenUid,
    TxOutputScript,
    VertexId,
    export,
    public,
    view,
)


@export
class FullBlueprint(Blueprint):
    vertex: VertexId

    amount: Amount

    address: Address

    tx_output_script: TxOutputScript

    token_uid: TokenUid

    timestamp: Timestamp

    contract_id: ContractId

    blueprint_id: BlueprintId

    attr_str: str

    attr_int: int

    attr_bytes: bytes

    attr_bool: bool

    attr_tuple: tuple[int, str, int]

    attr_set: set[str]

    attr_list: list[bytes]

    attr_dict_address: dict[Address, Amount]

    attr_dict_bytes: dict[bytes, int]

    attr_dict_str: dict[str, dict[str, int]]

    attr_dict_str_bytes: dict[str, dict[bytes, int]]

    attr_optional: Optional[str]

    attr_random_list: list[str]

    attr_list_0: str | None
    attr_list_1: str | None
    attr_list_2: str | None

    random_value: str | None

    attr_dict_list_tuple: dict[ContractId, list[tuple[int, bytes]]]
    attr_dict_dict_set: dict[TokenUid, dict[Address, set[str]]]
    attr_list_dict_tuple: list[dict[str, tuple[int, int]]]

    @public
    def initialize(self, ctx: Context, vertex: VertexId, amount: Amount,
                   address: Address, tx_output_script: TxOutputScript,
                   token_uid: TokenUid, timestamp: Timestamp, contract_id: ContractId,
                   blueprint_id: BlueprintId, attr_str: str,
                   attr_int: int, attr_bytes: bytes, attr_bool: bool, attr_set: set[str],
                   attr_tuple: tuple[int, str, int], attr_list: list[bytes]) -> None:

        self.vertex = vertex
        self.amount = amount
        self.address = address
        self.tx_output_script = tx_output_script
        self.token_uid = token_uid
        self.timestamp = timestamp
        self.contract_id = contract_id
        self.blueprint_id = blueprint_id
        self.attr_str = attr_str
        self.attr_int = attr_int
        self.attr_bytes = attr_bytes
        self.attr_bool = attr_bool
        self.attr_set = attr_set
        self.attr_tuple = attr_tuple
        self.attr_list = attr_list
        self.attr_optional = None
        self.attr_dict_address = {}
        self.attr_dict_bytes = {}
        self.attr_dict_str = {}
        self.attr_dict_str_bytes = {}
        self.attr_random_list = []
        self.attr_list_0 = None
        self.attr_list_1 = None
        self.attr_list_2 = None
        self.random_value = None
        self.attr_dict_list_tuple = {}
        self.attr_dict_dict_set = {}
        self.attr_list_dict_tuple = []

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

    @public
    def set_list_attrs(self, ctx: Context, attr: list[str]) -> None:
        self.attr_list_0 = attr[0]
        self.attr_list_1 = attr[1]
        self.attr_list_2 = attr[2]

    @public
    def set_tuple(self, ctx: Context, value: tuple[int, str, int]) -> None:
        self.attr_tuple = value

    @public
    def set_list(self, ctx: Context, value: list[bytes]) -> None:
        self.attr_list.append(value[0])
        self.attr_list.append(value[1])

    @public
    def set_set(self, ctx: Context, value: set[str]) -> None:
        self.attr_set.update(value)

    @public
    def set_attr_dict_list_tuple(self, ctx: Context, value: dict[ContractId, list[tuple[int, bytes]]]) -> None:
        partial = self.attr_dict_list_tuple.get(self.contract_id, [])
        partial.append(value[self.contract_id][0])
        partial.append(value[self.contract_id][1])
        self.attr_dict_list_tuple[self.contract_id] = partial

    @public
    def set_attr_dict_dict_set(self, ctx: Context, value: dict[TokenUid, dict[Address, set[str]]]) -> None:
        for token, dict_set in value.items():
            for addr, addr_set in dict_set.items():
                self.attr_dict_dict_set.get(token, {}).get(addr, set()).update(addr_set)

    @public
    def set_attr_list_dict_tuple(self, ctx: Context, value: list[dict[str, tuple[int, int]]]) -> None:
        self.attr_list_dict_tuple.append(value[0])
        self.attr_list_dict_tuple.append(value[1])

    @view
    def is_attr_optional_filled(self) -> bool:
        return self.attr_optional is not None

    @view
    def are_elements_inside_list(self, elements: list[bytes]) -> bool:
        for element in elements:
            if element not in self.attr_list:
                return False
        return True

    @view
    def are_elements_inside_set(self, elements: set[str]) -> bool:
        for element in elements:
            if element not in self.attr_set:
                return False
        return True

    @view
    def are_elements_inside_dict_dict_set(self, elements: set[str]) -> bool:
        set_to_search = self.attr_dict_dict_set.get(self.token_uid, {}).get(self.address, {})
        for element in elements:
            if element not in set_to_search:
                return False
        return True

    @view
    def is_tuple_inside_dict_list(self, element: tuple[int, bytes]) -> bool:
        list_to_search = self.attr_dict_list_tuple.get(self.contract_id, [])
        if element not in list_to_search:
            return False
        return True

    @view
    def is_dict_inside_list_dict_tuple(self, element: dict[str, tuple[int, int]]) -> bool:
        if element not in self.attr_list_dict_tuple:
            return False
        return True