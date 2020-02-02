# New Wallet Lib

### Start wallet

*Parameters:*

- network: Network you want the wallet connected to. E.g., 'testnet' or 'mainnet'.
- server: Server you want to connect to. E.g., 'https://node1.mainnet.hathor.network/v1a/'.
- seed: 24 words of this wallet in a string separated by space.
- tokenUid: Optional parameter if you want this wallet to work with an specific token only. E.g., '0000035f21f454686b3a01b59ae1345011501d0fcd8973d25d3d6ebe6f1c00bb'.

```
const data = {
    network: 'mainnet',
    server: 'https://node1.mainnet.hathor.network/v1a/',
    seed: '24 words',
    tokenUid: '0000035f21f454686b3a01b59ae1345011501d0fcd8973d25d3d6ebe6f1c00bb',
}

const wallet = Wallet(data);

console.log(wallet.state); // 0 = CLOSED

wallet.start(); // This will start the wallet and load its data from the server
```

### Wallet addresses

```
wallet.getAddressToUse(); // Return address and mark as used

wallet.getCurrentAddress(); // Return address
```

### Wallet balance

```
wallet.getBalance(); // Will return an object with 'available' and 'locked' in integer (no decimals).
                     // E.g., if the avaible is 28.13, it will return {available: 2813, locked: 0}.

// PS: If you want the balance of a token different from the wallet instance, you can pass as parameter the tokenUid.
// E.g. wallet.getBalance('00') will get the balance of HTR
```

### Send tokens

```
wallet.sendTransaction(address, value); // This method allow only one output, and it will send the token of the wallet instance
                                        // address is an string on base58 and value is an integer. E.g. if you want to send 10.23
                                        // you need to pass 1023 to the method.

// PS: If you want to send a different than the one of the wallet instance, you can pass as parameter the token object.
// E.g. wallet.sendTransaction(address, value, {uid: '00', name: 'Hathor', symbol: 'HTR'}) will send HTR and not the instance token.
```

### Wallet events

- state: every time the wallet state changes. The event parameter is the new state.
- new-tx: every time the wallet receives a new transaction. The event parameter is the new transaction.
- update-tx: every time the wallet receives an old transaction update. The event parameter is the updated transaction.