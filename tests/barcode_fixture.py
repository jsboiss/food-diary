"""Generate an EAN-13 fixture for the documented Open Food Facts example code."""
from pathlib import Path
import struct
import zlib

code = '3017620422003'
left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
parities = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
invert = lambda value: ''.join('1' if item == '0' else '0' for item in value)
bits = '101'
for digit, parity in zip(code[1:7], parities[int(code[0])]):
    pattern = left[int(digit)]
    bits += pattern if parity == 'L' else invert(pattern)[::-1]
bits += '01010' + ''.join(invert(left[int(digit)]) for digit in code[7:]) + '101'
bits = '0' * 12 + bits + '0' * 12
scale = 4
width, height = len(bits) * scale, 240
bar_row = b''.join((b'\x00' if bit == '1' else b'\xff') * scale for bit in bits)
rows = b''.join(b'\0' + (bar_row if 20 <= index < 220 else b'\xff' * width) for index in range(height))

def chunk(kind, body):
    return struct.pack('!I', len(body)) + kind + body + struct.pack('!I', zlib.crc32(kind + body) & 0xffffffff)

image = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
output = Path(__file__).resolve().parents[1] / 'test-results' / 'barcode-3017620422003.png'
output.parent.mkdir(exist_ok=True)
output.write_bytes(image)
print(output)
