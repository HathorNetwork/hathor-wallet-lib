#
# Copyright (c) Hathor Labs and its affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#

from hathor import (
    Blueprint,
    CallerId,
    Context,
    export,
    public,
)


@export
class UpgradeTestV2(Blueprint):
    """Upgraded version of UpgradeTestV1.

    State is identical (single `counter: int`) so the in-place upgrade via
    `syscall.change_blueprint` is storage-compatible. Only the public method
    signature of `set_value` differs: it now accepts a CallerId instead of an
    Address.
    """

    counter: int

    @public
    def initialize(self, ctx: Context) -> None:
        self.counter = 0

    @public
    def set_value(self, ctx: Context, addr: CallerId) -> None:
        self.counter += 1
