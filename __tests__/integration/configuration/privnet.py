from hathor.conf.settings import HathorSettings

# This file is the Private Network Configuration for the Fullnode
# It is consumed by the docker-compose.yml file on the integration folder.
# For more information, refer to:
# https://github.com/HathorNetwork/rfcs/blob/master/text/0033-private-network-guide.md

# This genesis adds the funds to the following wallet seed:
# avocado spot town typical traffic vault danger century property shallow divorce festival spend attack anchor afford rotate green audit adjust fade wagon depart level

SETTINGS = HathorSettings(
    P2PKH_VERSION_BYTE=b'\x49',
    MULTISIG_VERSION_BYTE=b'\x87',
    NETWORK_NAME='privatenet',
    BOOTSTRAP_DNS=[],
    ENABLE_PEER_WHITELIST=False,
    # Genesis stuff
    GENESIS_OUTPUT_SCRIPT=bytes.fromhex("76a91466665b27f7dbc4c8c089d2f686c170c74d66f0b588ac"),
    GENESIS_TIMESTAMP=1643902665,
    MIN_TX_WEIGHT_K=0,
    MIN_TX_WEIGHT_COEFFICIENT=0,
    MIN_TX_WEIGHT=1,
    REWARD_SPEND_MIN_BLOCKS=1,

    GENESIS_BLOCK_HASH=bytes.fromhex('00000334a21fbb58b4db8d7ff282d018e03e2977abd3004cf378fb1d677c3967'),
    GENESIS_BLOCK_NONCE=4784939,
    GENESIS_TX1_HASH=bytes.fromhex('54165cef1fd4cf2240d702b8383c307c822c16ca407f78014bdefa189a7571c2'),
    GENESIS_TX1_NONCE=0,
    GENESIS_TX2_HASH=bytes.fromhex('039906854ce6309b3180945f2a23deb9edff369753f7082e19053f5ac11bfbae'),
    GENESIS_TX2_NONCE=0
)
