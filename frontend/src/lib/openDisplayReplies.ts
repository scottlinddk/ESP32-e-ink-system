// Keep one bounded inbox for the entire direct-write flow: a fast device can
// emit END and REFRESH_COMPLETE during the same ATT write.
export class OpenDisplayReplies {
  private codes: number[] = [];
  private failure?: Error;
  private waiter?: { resolve: (code: number) => void; reject: (error: Error) => void };

  constructor(private char: BluetoothRemoteGATTCharacteristic, private onFailure: (error: Error) => void) {
    char.addEventListener('characteristicvaluechanged', this.onReply);
  }

  private fail(error: Error) {
    this.failure = error;
    this.waiter?.reject(error);
    this.waiter = undefined;
    this.codes = [];
    this.onFailure(error);
  }

  private onReply = () => {
    if (this.failure) return;
    const value = this.char.value;
    if (!value || value.byteLength < 2) {
      this.fail(new Error('Malformed OpenDisplay acknowledgement'));
      return;
    }
    const raw = value.getUint16(0, false);
    if ((raw & 0xff00) === 0xfe00 || (value.byteLength === 3 && value.getUint8(2) === 0xfe)) {
      this.fail(new Error('This OpenDisplay device requires an encryption key. Use an authenticated OpenDisplay client.'));
      return;
    }
    if (value.byteLength === 3 && value.getUint8(2) === 0xff) {
      this.fail(new Error('Display rejected the command integrity check.'));
      return;
    }
    if ((raw & 0xff00) === 0xff00) {
      this.fail(new Error(`Display rejected command 0x${(raw & 0xff).toString(16)}`));
      return;
    }
    const code = raw & 0x7fff;
    if (code === 0x74) {
      this.fail(new Error('Display reported a refresh timeout; refresh was not confirmed.'));
      return;
    }
    if (this.waiter) {
      this.waiter.resolve(code);
      this.waiter = undefined;
    } else if (this.codes.length < 4) {
      this.codes.push(code);
    } else {
      this.fail(new Error('Too many unsolicited OpenDisplay acknowledgements'));
    }
  };

  next(expected: number[]): Promise<number> {
    if (this.failure) throw this.failure;
    const validate = (code: number) => {
      if (!expected.includes(code)) {
        throw new Error(`Unexpected OpenDisplay acknowledgement 0x${code.toString(16)}; expected ${expected.map(value => `0x${value.toString(16)}`).join(' or ')}`);
      }
      return code;
    };
    // Reject a queued wrong echo before the caller starts another write.
    if (this.codes.length) return Promise.resolve(validate(this.codes.shift()!));
    return new Promise<number>((resolve, reject) => {
      this.waiter = { resolve, reject };
    }).then(validate);
  }

  dispose() {
    this.char.removeEventListener('characteristicvaluechanged', this.onReply);
    this.fail(new Error('Bluetooth transfer closed'));
  }
}
