"""Test text preparation without loading the GPU voice model."""
import ast
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / 'anjali-chatterbox-server.py'
tree = ast.parse(source.read_text(encoding='utf-8-sig'))
names = {'_letter_names', '_clean', '_expand_numbers', '_num_to_words'}
nodes = [n for n in tree.body if
         isinstance(n, ast.FunctionDef) and n.name in names or
         isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and
         t.id == 'INDIAN_ENGLISH_LETTER_NAMES' for t in n.targets)]
scope = {}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)

class LetterNames(unittest.TestCase):
    def test_all_letters(self):
        expected = 'A bee see dee E eff jee aitch eye jay kay ell em en oh pee cue ar ess tee you vee double_you ex why zed'.split()
        for letter, name in zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ', expected):
            self.assertEqual(scope['_letter_names'](letter + '.'), name.replace('_', ' ') + '.')

    def test_lists_and_examples(self):
        self.assertEqual(scope['_letter_names']('A, E, I, O, U.'), 'A, E, eye, oh, you.')
        self.assertEqual(scope['_letter_names']('Z for Zebra.'), 'zed for Zebra.')

    def test_preserves_sentences(self):
        for sentence in ['Now you know how to read and write ABC.',
                         'I have a doubt.', 'A dog is here.', 'The queue is long.']:
            self.assertEqual(scope['_clean'](sentence), sentence)

if __name__ == '__main__':
    unittest.main()
