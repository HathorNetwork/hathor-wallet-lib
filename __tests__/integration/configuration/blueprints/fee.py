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

from typing import Optional, TypeAlias

from hathor import (
    Address,
    Blueprint,
    ContractId,
    Context,
    NCAction,
    NCDepositAction,
    NCFee,
    NCWithdrawalAction,
    NCFail,
    SignedData,
    Timestamp,
    TokenUid,
    TxOutputScript,
    public,
    export,
    view,
)

@export
class FeeBlueprint(Blueprint):

    """
    Fee blueprint to create fee tokens and handle operations with them.

    The life cycle of contracts using this blueprint is the following:

    1. [Owner ] Create a contract (nc1).
    1. [Owner ] Create a contract (nc2).
    2. [User 1] `deposit htr and create_deposit_token(...)` on dbt_uid, and withdraw it without paying fees.
    3. [User 1] `deposit htr and create_fee_token(...)` on fbt_uid, and withdraw it paying fees.
    4. [User 1] `move_tokens_to_nc(...)` fbt from nc1 to nc2 paying fees.
    5. [User 1] `get_tokens_from_nc(...)` fbt from nc2 to nc1 paying fees.
    6. [User 1] `deposit fbt` into nc1 from the wallet.

    """

    fbt_uid: Optional[TokenUid]
    dbt_uid: Optional[TokenUid]
    
    @public(allow_deposit=True, allow_grant_authority=True)
    def initialize(self, ctx: Context) -> None:
        self.fbt_uid = None
        self.dbt_uid = None

    @public(allow_deposit=True, allow_grant_authority=True, allow_withdrawal=True)
    def create_fee_token(self, ctx: Context, name: str, symbol: str, amount: int) -> None:
        self.fbt_uid = self.syscall.create_fee_token(
            token_name=name,
            token_symbol=symbol,
            amount=amount,
            mint_authority=True,
            melt_authority=True,
        )

    @public(allow_deposit=True, allow_withdrawal=True, allow_grant_authority=True)
    def create_deposit_token(self, ctx: Context, name: str, symbol: str, amount: int) -> None:
        self.dbt_uid = self.syscall.create_deposit_token(token_name=name, token_symbol=symbol, amount=amount)

    @public(allow_deposit=True, allow_withdrawal=True, allow_grant_authority=True)
    def noop(self, ctx: Context) -> None:
        pass

    @public(allow_deposit=True, allow_withdrawal=True)
    def get_tokens_from_nc(
        self,
        ctx: Context,
        nc_id: ContractId,
        token_uid: TokenUid,
        token_amount: int,
        fee_payment_token: TokenUid,
        fee_amount: int
    ) -> None:
        action = NCWithdrawalAction(token_uid=token_uid, amount=token_amount)
        fees = [NCFee(token_uid=TokenUid(fee_payment_token), amount=fee_amount)]
        self.syscall.get_contract(nc_id, blueprint_id=None).public(action, fees=fees).noop()

    @public(allow_deposit=True, allow_withdrawal=True)
    def move_tokens_to_nc(
        self,
        ctx: Context,
        nc_id: ContractId,
        token_uid: TokenUid,
        token_amount: int,
        fee_payment_token: TokenUid,
        fee_amount: int
    ) -> None:
        action = NCDepositAction(token_uid=token_uid, amount=token_amount)
        fees = [NCFee(token_uid=TokenUid(fee_payment_token), amount=fee_amount)]
        self.syscall.get_contract(nc_id, blueprint_id=None).public(action, fees=fees).noop()

        
    
