# Copyright 2023 Hathor Labs
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from hathor import (
    Blueprint,
    Context,
    NCAction,
    NCDepositAction,
    NCGrantAuthorityAction,
    NCAcquireAuthorityAction,
    NCWithdrawalAction,
    NCFail,
    TokenUid,
    export,
    public,
)

class TooManyActions(NCFail):
    pass

@export
class AuthorityBlueprint(Blueprint):
    def _get_action(self, ctx: Context) -> NCAction:
        """Return the only action available; fails otherwise."""
        if len(ctx.actions) != 1:
            raise TooManyActions('only one token supported')
        return list(ctx.actions.values())[0][0]

    @public(allow_deposit=True)
    def initialize(self, ctx: Context) -> None:
        # Deposit so it can have funds to pay token deposit fee
        # for create token method
        action = self._get_action(ctx)
        assert isinstance(action, NCDepositAction)

    @public(allow_withdrawal=True)
    def create_token(self, ctx: Context) -> None:
        # Withdrawal to pay for token creation
        action = self._get_action(ctx)
        assert isinstance(action, NCWithdrawalAction)

    @public(allow_grant_authority=True)
    def grant_authority(self, ctx: Context) -> None:
        action = self._get_action(ctx)
        assert isinstance(action, NCGrantAuthorityAction)

    @public(allow_acquire_authority=True)
    def acquire_authority(self, ctx: Context) -> None:
        action = self._get_action(ctx)
        assert isinstance(action, NCAcquireAuthorityAction)

    @public
    def create_token_no_deposit(self, ctx: Context) -> None:
        # User will pay for token deposit
        if len(ctx.actions) != 0:
            raise NCFail('expect no actions')

    @public(allow_deposit=True, allow_grant_authority=True)
    def deposit_and_grant(self, ctx: Context, token_uid: TokenUid) -> None:
        if len(ctx.actions) != 1:
            raise NCFail('expect actions for a single token.')

        if len(ctx.actions[token_uid]) != 2:
            raise NCFail('expect two actions.')

    @public
    def mint(self, ctx: Context, token_uid: TokenUid, amount: int) -> None:
        self.syscall.mint_tokens(token_uid, amount)

    @public
    def melt(self, ctx: Context, token_uid: TokenUid, amount: int) -> None:
        self.syscall.melt_tokens(token_uid, amount)

    @public
    def revoke(self, ctx: Context, token_uid: TokenUid, revoke_mint: bool, revoke_melt: bool) -> None:
        self.syscall.revoke_authorities(token_uid=token_uid, revoke_mint=revoke_mint, revoke_melt=revoke_melt)