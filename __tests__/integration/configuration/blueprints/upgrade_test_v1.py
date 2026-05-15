#
# Copyright (c) Hathor Labs and its affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#

from hathor import (
    Address,
    Blueprint,
    BlueprintId,
    Context,
    export,
    public,
)


@export
class UpgradeTestV1(Blueprint):
    """Initial version of an upgradable blueprint used in upgrade tests.

    `set_value` accepts an Address. After upgrading to v2, the same method
    accepts a CallerId — exercising the wallet-lib path that resolves a
    contract's *current* blueprint id (state) rather than its *creation*
    blueprint id (tx).
    """

    counter: int

    @public
    def initialize(self, ctx: Context) -> None:
        self.counter = 0

    @public
    def set_value(self, ctx: Context, addr: Address) -> None:
        self.counter += 1

    @public
    def upgrade_to(self, ctx: Context, new_blueprint_id: BlueprintId) -> None:
        self.syscall.change_blueprint(new_blueprint_id)
