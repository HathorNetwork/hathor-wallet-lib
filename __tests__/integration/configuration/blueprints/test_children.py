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
    public,
)

class TestChildrenBlueprint(Blueprint):
    name: str

    attr: str

    @public
    def initialize(self, ctx: Context, name: str) -> None:
        self.name = name

    @public
    def set_attr(self, ctx: Context, attr: str) -> None:
        self.attr = attr
 
__blueprint__ = TestChildrenBlueprint
