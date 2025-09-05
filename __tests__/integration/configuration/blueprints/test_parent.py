#
# Copyright (c) Hathor Labs and its affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#

from hathor.nanocontracts.blueprint import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.exception import NCFail
from hathor.nanocontracts.types import (
    Amount,
    BlueprintId,
    ContractId,
    TokenUid,
    NCAction,
    NCDepositAction,
    public,
)

class TooManyActions(NCFail):
    pass

class TestParentBlueprint(Blueprint):
    last_created_token: TokenUid

    last_created_contract: ContractId

    def _get_action(self, ctx: Context) -> NCAction:
        """Return the only action available; fails otherwise."""
        if len(ctx.actions) != 1:
            raise TooManyActions('only one token supported')
        return list(ctx.actions.values())[0][0]

    @public
    def initialize(self, ctx: Context) -> None:
        pass

    @public(allow_deposit=True)
    def deposit(self, ctx: Context) -> None:
        action = self._get_action(ctx)
        assert isinstance(action, NCDepositAction)

    @public
    def create_token(self, ctx: Context, name: str, symbol: str, amount: Amount, mint_authority: bool, melt_authority: bool) -> None:
        self.last_created_token = self.syscall.create_token(name, symbol, amount, mint_authority, melt_authority)
 
    @public
    def create_child_contract(self, ctx: Context, blueprint_id: BlueprintId, salt: bytes, contract_name: str) -> None:
        return_tuple = self.syscall.create_contract(blueprint_id, salt, [], contract_name)
        self.last_created_contract = return_tuple[0]
 
__blueprint__ = TestParentBlueprint